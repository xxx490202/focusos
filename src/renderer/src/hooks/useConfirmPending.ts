// ============================================================
//  useConfirmPending.ts — 把「待确认日程」确认为正式日程
// ============================================================
//  ⭐ 日视图与周视图共用同一套交互：
//     点空心圆 → 变实心（停留一瞬）→ 整颗消失 → 字体恢复正常色。
//
//  ⚠️ 330ms 的那段等待不是装饰：它就是「变实心之后消失」里的「之后」。
//     立刻落库的话，pending 一变 false，圆会直接不见，用户看不到任何反馈，
//     会以为没点上而反复点击。
// ============================================================
import { useCallback, useState } from 'react'
import { useDataStore } from '../stores/useDataStore'
import { useUIStore } from '../stores/useUIStore'
import { t } from '../i18n'

/** 「实心」停留时长（与 ConfirmDot 的 transition 时长对齐） */
const FILL_HOLD_MS = 320

export function useConfirmPending() {
  const reload = useDataStore((s) => s.reload)
  const toast = useUIStore((s) => s.toast)
  /** 正在播放实心动效的块 id */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const confirmPending = useCallback(
    async (taskId: string) => {
      setConfirmingId(taskId)
      await new Promise((r) => setTimeout(r, FILL_HOLD_MS))
      const res = await window.api.task.update(taskId, { pending: false })
      setConfirmingId(null)
      if (!res.ok) {
        toast(res.error ?? t('确认失败'), 'error')
        return
      }
      await reload()
      toast(t('已确认为正式日程'), 'success')
    },
    [reload, toast]
  )

  return { confirmingId, confirmPending }
}
