// ============================================================
//  useCreateTask.ts — 新建日程的统一入口（含时段冲突确认）
// ============================================================
//  ⭐ 用户规则：
//     · 新建出来的日程默认是「待确认」态（灰字 + 空心圆），点掉空心圆才算落定
//     · 若新事件的时段**已有其它安排**，必须先弹窗提示，
//       点「确认创建」才真的创建；创建后两个事件上下排列（见 stackPendingBlocks）
//
//  ⚠️ 冲突检测只在渲染层做（数据都在 store 里，不必往返主进程）。
//     比对时忽略「待确认」的任务：两个都没落定的待办互相撞车不算冲突，
//     否则新建第一条待确认任务后再建第二条，会平白弹一次确认框。
// ============================================================
import { useCallback } from 'react'
import { useDataStore } from '../stores/useDataStore'
import { useUIStore } from '../stores/useUIStore'
import { timeToMinutes } from '@shared/schedule'
import type { Task } from '@shared/types'
import { t } from '../i18n'

/** 任务的时间区间（分钟），startTime 缺失返回 null */
function taskRange(task: Task): { startMin: number; endMin: number } | null {
  const s = timeToMinutes(task.startTime ?? '')
  if (s === null) return null
  const e = timeToMinutes(task.endTime ?? '')
  return { startMin: s, endMin: e !== null && e > s ? e : s + 60 }
}

/**
 * 某天已被占用的分钟区间。
 * ⚠️ 这里**包含**待确认任务：两条新任务都还没落定，但也不能被安排到同一个格子里，
 *    否则用户会看到两个灰色块叠在一起，分不清哪条是哪条。
 */
export function occupiedRanges(tasks: Task[], date: string): { startMin: number; endMin: number }[] {
  const out: { startMin: number; endMin: number }[] = []
  for (const task of tasks) {
    if (task.date !== date) continue
    if (task.status === 'archived') continue
    const r = taskRange(task)
    if (r) out.push(r)
  }
  return out
}

/** 找出与新日程时段重叠的第一条已确认任务 */
export function findSlotCollision(
  tasks: Task[],
  draft: { date?: string | null; startTime?: string; endTime?: string }
): Task | null {
  if (!draft.date || !draft.startTime) return null
  const start = timeToMinutes(draft.startTime)
  const rawEnd = timeToMinutes(draft.endTime ?? '')
  // 没给结束时间就按默认时长算区间，否则「有开始没结束」永远判不出冲突
  const end = rawEnd !== null && rawEnd > (start ?? 0) ? rawEnd : (start ?? 0) + 60
  if (start === null) return null

  for (const task of tasks) {
    if (task.date !== draft.date) continue
    if (task.status === 'archived') continue
    // 待确认之间互不视为冲突（都还没落定）
    if (task.pending === true) continue
    const s = timeToMinutes(task.startTime ?? '')
    if (s === null) continue
    const e = timeToMinutes(task.endTime ?? '')
    const ee = e !== null && e > s ? e : s + 60
    // 半开区间：首尾相接不算冲突
    if (start < ee && s < end) return task
  }
  return null
}

/** 新建结果：已创建 / 正在等用户确认 / 失败 */
export type CreateOutcome = 'created' | 'confirming' | 'failed'

export function useCreateTask() {
  const tasks = useDataStore((s) => s.tasks)
  const reload = useDataStore((s) => s.reload)
  const toast = useUIStore((s) => s.toast)
  const askConfirm = useUIStore((s) => s.askConfirm)

  const create = useCallback(
    async (draft: Partial<Task>, opts?: { successMessage?: string }): Promise<CreateOutcome> => {
      const success = opts?.successMessage ?? t('已创建')

      const doCreate = async (): Promise<CreateOutcome> => {
        const r = await window.api.task.create(draft)
        if (!r.ok) {
          toast(r.error, 'error')
          return 'failed'
        }
        await reload()
        toast(success, 'success')
        return 'created'
      }

      const hit = findSlotCollision(tasks, draft)
      if (!hit) return doCreate()

      askConfirm({
        title: t('该时段已有安排'),
        message: t('「{existing}」已占用这个时间，「{next}」和它重叠。确认后两个事件会上下排列。', {
          existing: hit.title,
          next: draft.title ?? ''
        }),
        confirmLabel: t('确认创建'),
        onConfirm: async () => {
          await doCreate()
        }
      })
      /*
       * ⚠️ 返回 'confirming' 而不是 'failed'：
       *    调用方据此把「新建任务」弹窗关掉。否则确认框还开着时表单会一直挂着，
       *    后台数据一变（reload）弹窗里的 useEffect 又会把用户填的内容重置掉。
       */
      return 'confirming'
    },
    [tasks, reload, toast, askConfirm]
  )

  return create
}
