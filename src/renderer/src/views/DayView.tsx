// ============================================================
//  DayView.tsx — 日视图
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DayTimeline } from '../components/schedule/DayTimeline'
import { CalendarPanel } from '../components/schedule/CalendarPanel'
import { EmptyState } from '../components/common/EmptyState'
import { IconCalendar, IconSparkle, IconClose, IconCheck } from '../components/common/Icons'
import { useDataStore } from '../stores/useDataStore'
import { useUIStore, todayKey } from '../stores/useUIStore'
import { useT, useI18n } from '../i18n'
import { monthLabel, weekdayLabel, translate } from '@shared/i18n'
import {
  expandRepeatingTasks, blockOfTask, minutesToTime, dayOfWeek, layoutTimeline, formatDuration,
  type TimeBlock
} from '@shared/schedule'
import type { Task } from '@shared/types'
import type { PlanPreviewBlock } from '@shared/types'
import { useConfirmPending } from '../hooks/useConfirmPending'
import styles from './DayView.module.css'

export function DayView() {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const tasks = useDataStore((s) => s.tasks)
  const planBlocks = useDataStore((s) => s.planBlocks)
  const stats = useDataStore((s) => s.dailyStats)
  const settings = useDataStore((s) => s.settings)
  const reload = useDataStore((s) => s.reload)

  const selectedDate = useUIStore((s) => s.selectedDate)
  const setSelectedDate = useUIStore((s) => s.setSelectedDate)
  const hourHeight = useUIStore((s) => s.hourHeight)
  const setHourHeight = useUIStore((s) => s.setHourHeight)
  const openTaskModal = useUIStore((s) => s.openTaskModal)
  const toast = useUIStore((s) => s.toast)
  const planPreview = useUIStore((s) => s.planPreview)
  const setPlanPreview = useUIStore((s) => s.setPlanPreview)
  const clearPlanPreview = useUIStore((s) => s.clearPlanPreview)
  const openBlockMenu = useUIStore((s) => s.openBlockMenu)
  const askConfirm = useUIStore((s) => s.askConfirm)
  const toastWithAction = useUIStore((s) => s.toastWithAction)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 日历面板开关（与周视图共用同一个 CalendarPanel） */
  const [pickerOpen, setPickerOpen] = useState(false)
  const { confirmingId, confirmPending } = useConfirmPending()

  const today = todayKey()
  const isToday = selectedDate === today
  /*
   * 过去的日期是**只读**的：日子已经过完，再往里塞任务是自欺欺人。
   * ISO 日期（YYYY-MM-DD）字典序即时间序，直接比字符串即可，不必构造 Date。
   */
  const isPast = selectedDate < today

  // 循环任务展开为实例
  const blocks = useMemo<TimeBlock[]>(() => {
    const expanded = expandRepeatingTasks(tasks, selectedDate, selectedDate, todayKey())
    const out: TimeBlock[] = []
    for (const t of expanded) {
      // 循环实例 id 带 @日期，需映射回原任务 id
      const baseId = t.id.split('@')[0]
      const b = blockOfTask({ ...t, id: baseId }, settings.defaultTaskMinutes)
      if (b) out.push(b)
    }
    // 计划块并入
    for (const p of planBlocks) {
      if (p.date !== selectedDate) continue
      const task = tasks.find((t) => t.id === p.taskId)
      const sh = Number(p.startTime.slice(0, 2)) * 60 + Number(p.startTime.slice(3))
      const eh = Number(p.endTime.slice(0, 2)) * 60 + Number(p.endTime.slice(3))
      out.push({
        id: p.id,
        taskId: p.taskId,
        title: task?.title ?? translate('专注', lang),
        date: p.date,
        startMin: sh,
        endMin: eh > sh ? eh : sh + settings.durations.workMinutes,
        category: task?.category ?? 'work',
        priority: task?.priority ?? 1,
        status: task?.status ?? 'todo',
        kind: 'plan',
        phase: p.phase,
        repeat: 'none'
      })
    }
    return out.sort((a, b) => a.startMin - b.startMin)
    /*
     * lang 必须在依赖里：计划块的兜底标题「专注」是按语言取的，
     * 切换语言时这份 memo 要重算，否则块上会残留上一种语言。
     * ⚠️ 这里用 translate(x, lang) 而不是组件的 t() —— t() 每次渲染都是新引用，
     *    放进依赖会让 memo 完全失效。
     */
  }, [tasks, planBlocks, selectedDate, settings, lang])

  // 预览态转成时间轴可画的范围
  const previewRanges = useMemo(
    () =>
      planPreview.map((b: PlanPreviewBlock) => {
        const s = Number(b.startTime.slice(0, 2)) * 60 + Number(b.startTime.slice(3))
        const e = Number(b.endTime.slice(0, 2)) * 60 + Number(b.endTime.slice(3))
        return { startMin: s, endMin: e }
      }),
    [planPreview]
  )

  /*
   * 时间轴排版：块必须放得下「标题 + 时间」。
   * 38px ≈ 上下内边距 8 + 标题 13 + 间隔 1 + 时间 11 + 边框 2 —— 低于这个高度
   * 文字就会被裁掉（25 分钟的番茄计划块正是这种情况，用户截图反馈）。
   * 不足的块按最少分钟数撑高并与后续块上下排开；
   * 同时返回时间轴映射，让左边的刻度与网格线跟着一起被撑开。
   */
  const layout = useMemo(
    () => layoutTimeline(blocks, Math.ceil((38 / hourHeight) * 60)),
    [blocks, hourHeight]
  )

  // ---------------- 操作 ----------------
  const handleMove = useCallback(
    async (id: string, startMin: number) => {
      const block = blocks.find((b) => b.id === id)
      if (!block) return
      const duration = block.endMin - block.startMin
      const patch: Partial<Task> = {
        date: selectedDate,
        startTime: minutesToTime(startMin),
        endTime: minutesToTime(Math.min(24 * 60, startMin + duration))
      }
      if (block.kind === 'plan') {
        // 计划块：同步其源任务
        const r = await window.api.task.update(block.taskId, patch)
        if (!r.ok) toast(r.error, 'error')
      } else {
        const r = await window.api.task.update(id, patch)
        if (!r.ok) toast(r.error, 'error')
      }
      await reload()
    },
    [blocks, selectedDate, reload, toast]
  )

  const handleResize = useCallback(
    async (id: string, endMin: number) => {
      const block = blocks.find((b) => b.id === id)
      if (!block) return
      const patch: Partial<Task> = { endTime: minutesToTime(endMin) }
      const r =
        block.kind === 'plan'
          ? await window.api.task.update(block.taskId, patch)
          : await window.api.task.update(id, patch)
      if (!r.ok) toast(r.error, 'error')
      await reload()
    },
    [blocks, reload, toast]
  )

  /**
   * 删除时间轴上的一块（键盘 Delete 或右键菜单）。
   * ⚠️ 语义必须区分：
   *    · 计划块 → 只删这一块（plan.remove），源任务要保留
   *    · 任务块 → 删整个任务
   *    早先这里对计划块调的是 task.remove(taskId)，会把用户的任务一起删掉，
   *    而且用的是原生 window.confirm（阻塞渲染进程、样式不可控）。
   *    现在统一走应用内二次确认弹窗。
   */
  const handleDelete = useCallback(
    (id: string) => {
      const block = blocks.find((b) => b.id === id)
      if (!block) return
      const isPlan = block.kind === 'plan'
      askConfirm({
        title: isPlan ? t('删除计划块') : t('删除日程事件'),
        message: isPlan
          ? t('确定删除「{title}」的这一块吗？只删这一块，原任务不受影响。', { title: block.title })
          : t('确定删除「{title}」吗？会连同这个任务一起删除，此操作不可撤销。', { title: block.title }),
        confirmLabel: t('删除'),
        danger: true,
        onConfirm: async () => {
          const r = isPlan
            ? await window.api.plan.remove(id)
            : await window.api.task.remove(id)
          if (!r.ok) {
            toast(r.error ?? t('删除失败'), 'error')
            return
          }
          await reload()
          toast(t('已删除'), 'success')
        }
      })
    },
    [blocks, reload, toast, askConfirm]
  )

  /** 右键事件块 → 在指针位置弹菜单 */
  const handleContextMenuBlock = useCallback(
    (id: string, x: number, y: number) => {
      const block = blocks.find((b) => b.id === id)
      if (!block) return
      openBlockMenu({
        blockId: id,
        kind: block.kind === 'plan' ? 'plan' : 'task',
        taskId: block.kind === 'plan' ? block.taskId : null,
        title: block.title,
        x,
        y,
        // 重复实例的「只删这一次」需要日期与重复规则
        date: block.date,
        repeat: block.repeat
      })
    },
    [blocks, openBlockMenu]
  )

  const handleCreateAt = useCallback(
    (startMin: number) => {
      // 过去的日子只读：双击空白也不该开编辑框，否则空状态里没按钮、双击却能建，自相矛盾
      if (isPast) {
        toast(t('已经过去的日期无法新增任务'))
        return
      }
      openTaskModal()
      // 通过 sessionStorage 把时段带到编辑模态框
      sessionStorage.setItem(
        'focusos:newTaskSlot',
        JSON.stringify({
          date: selectedDate,
          startTime: minutesToTime(startMin),
          endTime: minutesToTime(Math.min(24 * 60, startMin + settings.defaultTaskMinutes))
        })
      )
    },
    [isPast, toast, t, openTaskModal, selectedDate, settings.defaultTaskMinutes]
  )

  // ---------------- 生成番茄计划 ----------------
  const [planWindow, setPlanWindow] = useState(false)
  const [windowStart, setWindowStart] = useState('09:00')
  const [windowEnd, setWindowEnd] = useState('12:00')

  const scheduledTasks = tasks.filter((t) => t.date === selectedDate && t.estimatedPomodoros > 0)

  // ---------------- 结束今天 ----------------
  /*
   * ⭐ 收尾仪式：把今天没做完的任务顺延到明天，并给一句当日小结。
   *    价值不在「搬家」这个动作，而在于让一天有明确的结束点 ——
   *    不结束的话，未完成的任务会一直挂在今天，越积越多。
   */
  const finishDay = useCallback(() => {
    const tomorrow = shiftDate(selectedDate, 1)
    const unfinished = tasks.filter(
      (task) =>
        task.date === selectedDate && task.status !== 'done' && task.status !== 'archived'
    )

    askConfirm({
      title: t('结束今天'),
      message:
        unfinished.length > 0
          ? t('把今天剩下 {n} 条未完成的任务顺延到 {date}？', {
              n: unfinished.length,
              date: tomorrow
            })
          : t('今天没有未完成的任务，要生成一份今日小结吗？'),
      confirmLabel: t('结束今天'),
      // 顺延不是破坏性操作，用主色按钮而不是危险色
      danger: false,
      onConfirm: async () => {
        const r = await window.api.day.rollover(selectedDate, tomorrow)
        if (!r.ok) {
          toast(r.error, 'error')
          return
        }
        await reload()
        const stat = stats.find((s) => s.date === selectedDate)
        toastWithAction(
          t('今日小结：完成 {done} 个番茄 · 专注 {focus} · 顺延 {moved} 条', {
            done: stat?.focusCount ?? 0,
            focus: formatDuration(stat?.focusSeconds ?? 0),
            moved: r.data.moved
          }),
          { label: t('查看明天'), onClick: () => setSelectedDate(tomorrow) },
          'success'
        )
      }
    })
  }, [selectedDate, tasks, stats, askConfirm, reload, toast, toastWithAction, t])

  const runGenerate = useCallback(async () => {
    if (isPast) {
      toast(t('已经过去的日期无法生成番茄计划'))
      return
    }
    if (scheduledTasks.length === 0) {
      toast(t('今天没有需要排计划的任务'), 'error')
      return
    }
    const r = await window.api.plan.generate({
      taskIds: scheduledTasks.map((t) => t.id),
      date: selectedDate,
      windowStart,
      windowEnd
    })
    if (!r.ok) {
      toast(r.error, 'error')
      return
    }
    setPlanPreview(r.data.blocks, selectedDate)
    if (r.data.blocks.length === 0) {
      toast(t('该时间窗内没有可排入的空间'), 'error')
    } else {
      const skipInfo =
        r.data.skipped.length > 0
          ? t('（跳过 {n} 项：{reasons}）', {
              n: r.data.skipped.reduce((a: number, b: { count: number }) => a + b.count, 0),
              reasons: r.data.skipped.map((s: { reason: string }) => s.reason).join('、')
            })
          : ''
      toast(t('已生成 {n} 个计划块{extra}', { n: r.data.blocks.length, extra: skipInfo }))
    }
    setPlanWindow(false)
  }, [isPast, scheduledTasks, selectedDate, windowStart, windowEnd, setPlanPreview, toast, t])

  // ---------------- 焦点时自动开始对应任务的计时 ----------------
  useEffect(() => {
    const off = window.api.on('window:mode', () => undefined)
    return off
  }, [])

  return (
    <div className={styles.root}>
      {/* 工具条 */}
      {/* 顶栏同时是窗口拖拽区（macOS 无原生标题栏）。
          交互控件由 global.css 的 [data-drag] 规则自动退出拖拽区。 */}
      <header className={styles.bar} data-drag="1">
        <div className={styles.dateNav}>
          <button className={styles.navBtn} onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}>
            ‹
          </button>
          {/*
            日期按钮 → 打开 CalendarPanel。
            与周视图是**同一个**日历组件（用户要求「两页共用同一个面板」），
            区别只是高亮粒度：这里是单日，周视图是整周。
          */}
          <button
            className={styles.dateInput}
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-label={t('选择日期')}
            title={t('选择日期')}
            data-testid="day-date-btn"
          >
            {dayLabel(selectedDate, lang)}
          </button>
          <button className={styles.navBtn} onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}>
            ›
          </button>
          {!isToday && (
            <button className={styles.todayBtn} onClick={() => setSelectedDate(today)}>
              {t('回到今天')}
            </button>
          )}
        </div>

        <div className={styles.barRight}>
          {/* 结束今天只对「今天」有意义：给别的日期收尾会让人困惑 */}
          {isToday && (
            <button
              className={styles.actionBtn}
              onClick={finishDay}
              title={t('把未完成的任务顺延到明天，并生成今日小结')}
              data-testid="finish-day-btn"
            >
              <IconCheck size={14} />
              <span>{t('结束今天')}</span>
            </button>
          )}
          {/* 过去的日子是回顾模式：不给任何「新建/排计划」入口 */}
          {!isPast && (
            <button className={styles.actionBtn} onClick={() => setPlanWindow(true)}>
              <IconSparkle size={14} />
              <span>{t('生成番茄计划')}</span>
            </button>
          )}
          <div className={styles.zoomGroup}>
            {([48, 64, 96] as const).map((h) => (
              <button
                key={h}
                className={styles.zoomBtn}
                data-active={hourHeight === h ? 'true' : 'false'}
                onClick={() => setHourHeight(h)}
              >
                {t(h === 48 ? '紧凑' : h === 64 ? '标准' : '宽松')}
              </button>
            ))}
          </div>
        </div>
      </header>

      {pickerOpen && (
        <CalendarPanel
          anchorDate={selectedDate}
          mode="day"
          weekStartsOn={settings.weekStartsOn}
          today={today}
          onPick={(d) => setSelectedDate(d)}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* 计划确认条 */}
      {planPreview.length > 0 && (
        <div className={styles.planBar}>
          <IconSparkle size={15} />
          <span className={styles.planBarText}>
            {t('预览 {n} 个计划块，确认后写入日程', { n: planPreview.length })}
          </span>
          <div className={styles.planBarOps}>
            <button
              className={styles.planConfirm}
              onClick={async () => {
                const r = await window.api.plan.commit(selectedDate)
                if (r.ok) {
                  clearPlanPreview()
                  toast(t('已排入 {n} 个计划块', { n: r.data.length }), 'success')
                  const p = await window.api.plan.list()
                  if (p.ok) useDataStore.setState({ planBlocks: p.data })
                } else toast(r.error, 'error')
              }}
            >
              <IconCheck size={14} />
              <span>{t('确认排入')}</span>
            </button>
            <button
              className={styles.planDiscard}
              onClick={async () => {
                await window.api.plan.discard()
                clearPlanPreview()
              }}
            >
              <IconClose size={14} />
              <span>{t('放弃')}</span>
            </button>
          </div>
        </div>
      )}

      {/* 时间轴 */}
      <div className={styles.body}>
        <DayTimeline
          blocks={blocks}
          hourHeight={hourHeight}
          date={selectedDate}
          isToday={isToday}
          selectedId={selectedId}
          preview={previewRanges}
          layout={layout}
          confirmingId={confirmingId}
          onConfirmPending={(id) => void confirmPending(id)}
          onSelect={setSelectedId}
          onMove={(id, m) => void handleMove(id, m)}
          onResize={(id, e) => void handleResize(id, e)}
          onDelete={(id) => void handleDelete(id)}
          onEdit={(id) => openTaskModal(id)}
          onCreateAt={handleCreateAt}
          onContextMenuBlock={handleContextMenuBlock}
        />
      </div>

      {/* 生成计划时间窗 */}
      {planWindow && (
        <div className={styles.modalMask} onClick={() => setPlanWindow(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>{t('生成番茄计划')}</h3>
            <p className={styles.modalDesc}>
              {t('将当天 {n} 个任务展开为专注块，跳过已占用时间、勿扰时段与每日上限。', { n: scheduledTasks.length })}
            </p>
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span>{t('时间窗起')}</span>
                <input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>{t('时间窗止')}</span>
                <input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
              </label>
            </div>
            <div className={styles.modalOps}>
              <button className={styles.btnGhost} onClick={() => setPlanWindow(false)}>
                {t('取消')}
              </button>
              <button className={styles.btnPrimary} onClick={() => void runGenerate()}>
                {t('生成预览')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
         * 空状态分两种语气：
         *   · 今天/未来 → 引导型，给「双击新建」的提示和主按钮
         *   · 过去     → 陈述型，只说明那天没有安排，不提新建
         *     （「都已经过去了还要新增啥任务」——用户原话）
         */}
      {blocks.length === 0 && planPreview.length === 0 && (
        <div className={styles.emptyOverlay}>
          {isPast ? (
            <EmptyState
              icon={<IconCalendar size={28} />}
              title={t('这一天还没有安排')}
              desc={t('这一天已经过去，没有留下任何安排记录。')}
            />
          ) : (
            <EmptyState
              icon={<IconCalendar size={28} />}
              title={t('这一天还没有安排')}
              desc={t('双击时间轴任意位置即可新建任务，或从左侧收件箱拖动过来。')}
              action={{ label: t('新建任务'), onClick: () => openTaskModal() }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 顶栏上的日期文案。
 * 中文：`10 月 14 日 周三`；英文：`Wed, Oct 14`。
 * ⚠️ 语序与标点完全不同，靠词典逐词拼不出来，因此按语言分别构造。
 */
function dayLabel(date: string, lang: 'zh' | 'en'): string {
  const m = Number(date.slice(5, 7)) - 1
  const d = Number(date.slice(8, 10))
  const dow = dayOfWeek(date)
  if (lang === 'zh') {
    return `${m + 1} 月 ${d} 日 ${weekdayLabel(dow, 'zh', true)}`
  }
  return `${weekdayLabel(dow, 'en')}, ${monthLabel(m, 'en')} ${d}`
}
