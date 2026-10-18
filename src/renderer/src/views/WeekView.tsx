// ============================================================
//  WeekView.tsx — 周视图（7 天 × 24 小时时间网格）
// ============================================================
//  布局：
//    ┌──────────┬─────┬─────┬ … ┬─────┐
//    │ 08:00~…  │ 周一 │ 周二 │   │ 周日 │   ← 表头行（固定）
//    ├──────────┼─────┼─────┼ … ┼─────┤
//    │ 00:00    │     │     │   │     │
//    │ 01:00    │     │  ▨  │   │     │   ← 纵向滚动区
//    │ …        │     │     │   │     │
//    │ 24:00    │     │     │   │     │
//    └──────────┴─────┴─────┴ … ┴─────┘
//
//  ⚠️ 左上角的时间格是**日历入口**：点击弹出 MonthPicker，
//     选中一整周后表头与网格整体切过去。
//  ⚠️ 刻度列与网格同处一个滚动流（与 DayTimeline 同一套做法），
//     否则滚动时小时标签会与网格错位。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDataStore } from '../stores/useDataStore'
import {
  expandRepeatingTasks, blockOfTask, dateToKey, addDays, startOfWeek, dayOfWeek,
  layoutTimeline, minutesToTime, snapToStep, clampMinutes,
  type TimeBlock
} from '@shared/schedule'
import { weekdayLabel, monthLabel } from '@shared/i18n'
import { CATEGORY_LABEL } from '@shared/defaults'
import { useUIStore, todayKey } from '../stores/useUIStore'
import { useT, useI18n } from '../i18n'
import { EmptyState } from '../components/common/EmptyState'
import { CalendarPanel } from '../components/schedule/CalendarPanel'
import { ConfirmDot } from '../components/schedule/ConfirmDot'
import { useConfirmPending } from '../hooks/useConfirmPending'
import { IconWeek } from '../components/common/Icons'
import styles from './WeekView.module.css'

const HOUR_H = 44
const HOURS = Array.from({ length: 24 }, (_, i) => i)
/** 打开时默认滚到 07:00 —— 谁也不想先看一夜的空白 */
const DEFAULT_SCROLL_HOUR = 7

export function WeekView() {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const tasks = useDataStore((s) => s.tasks)
  const stats = useDataStore((s) => s.dailyStats)
  const settings = useDataStore((s) => s.settings)
  const setView = useUIStore((s) => s.setView)
  const setSelectedDate = useUIStore((s) => s.setSelectedDate)
  const openBlockMenu = useUIStore((s) => s.openBlockMenu)

  const [anchor, setAnchor] = useState(() => todayKey())
  const [pickerOpen, setPickerOpen] = useState(false)
  const { confirmingId, confirmPending } = useConfirmPending()

  const today = todayKey()
  const weekStartsOn = settings.weekStartsOn

  const weekStartKey = useMemo(
    () => startOfWeek(anchor, weekStartsOn),
    [anchor, weekStartsOn]
  )

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const key = addDays(weekStartKey, i)
        // 用 dayOfWeek（UTC 计算）而不是 new Date(`${key}T00:00:00`).getDay()，
        // 与全项目其余日期运算保持同一套口径
        return { key, dow: dayOfWeek(key) }
      }),
    [weekStartKey]
  )

  const from = days[0].key
  const to = days[6].key

  const blocksByDay = useMemo(() => {
    const map = new Map<string, TimeBlock[]>()
    for (const t of expandRepeatingTasks(tasks, from, to, todayKey())) {
      const b = blockOfTask({ ...t, id: t.id.split('@')[0] }, 60)
      if (!b) continue
      const list = map.get(b.date)
      if (list) list.push(b)
      else map.set(b.date, [b])
    }
    return map
  }, [tasks, from, to])

  const weekFocusCount = useMemo(
    () => stats.filter((s) => s.date >= from && s.date <= to).reduce((a, s) => a + s.focusCount, 0),
    [stats, from, to]
  )

  const totalBlocks = useMemo(() => {
    let n = 0
    for (const list of blocksByDay.values()) n += list.length
    return n
  }, [blocksByDay])

  const allBlocks = useMemo(() => {
    const out: TimeBlock[] = []
    for (const list of blocksByDay.values()) out.push(...list)
    return out
  }, [blocksByDay])

  /*
   * 绘制排版：与日视图**同一套**规则（用户要求「可以参照今日日程那边的」）。
   *   · 放不下内容的块按最少高度撑开
   *   · 撑开 / 撞车产生的重叠靠上下排列解决，不左右分栏
   *   · layout.toDrawn 让**刻度列与网格线跟着一起拉伸** ——
   *     某一天有两个事件挤在 09:00–10:00，这一段在整条时间轴上就变高
   *
   * ⚠️ 周视图 7 列共用一条时间轴，所以只能用**整周**的一份映射：
   *    每列各用各的会让「10:00」在七列里对不上同一条线。
   *    layoutTimeline 内部本来就按日期分组算，最终得到的是全周统一的阶梯。
   */
  const layout = useMemo(
    () => layoutTimeline(allBlocks, Math.ceil((22 / HOUR_H) * 60)),
    [allBlocks]
  )
  const stack = layout.blocks

  /** 真实分钟 → 绘制 Y */
  const yOfReal = useCallback((m: number) => (layout.toDrawn(m) / 60) * HOUR_H, [layout])
  /** 已经是绘制分钟 → Y */
  const yOfDrawn = useCallback((m: number) => (m / 60) * HOUR_H, [])

  // ---------------- 周视图拖拽 ----------------
  /*
   * ⭐ 用户要求：周视图的事件块能像日视图那样拖动。
   *   · 纵向拖 = 改时间（15 分钟吸附）
   *   · 横向拖 = 改日期
   *
   * 拖拽期间用**浮层**渲染跟随指针的那一块，原地的那块压暗 ——
   * 直接把块在列之间搬家会让 React 在 7 个数组里来回插拔，抖动明显。
   */
  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{
    id: string
    title: string
    category: TimeBlock['category']
    /** 抓取点相对块顶部的偏移（绘制分钟） */
    grabOffset: number
    durationMin: number
    date: string
    startMin: number
    /** 按下那一刻的落点，用来判断「有没有真的动过」 */
    originDate: string
    originStart: number
  } | null>(null)

  const beginDrag = useCallback((e: React.MouseEvent, b: TimeBlock, drawnStartMin: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    /*
     * ⭐ 抓取偏移必须和 onMove 用**同一个原点**（网格的 rect.top）。
     * 早先这里用的是 e.currentTarget（块自己）的 rect.top，
     * 而 onMove 用的是网格的 rect.top —— 两套坐标系混用，
     * 等于给 grabOffset 偷偷加了一个「块顶端距网格顶端的距离」，
     * 结果是**每按一下块都会先跳一大截**（10:00 的块直接跳到 20:00），
     * 用户反馈「鼠标点击后会乱跑」。
     */
    const grid = gridRef.current
    const gridTop = grid ? grid.getBoundingClientRect().top : 0
    const drawnGrab = ((e.clientY - gridTop) / HOUR_H) * 60
    setDrag({
      id: b.id,
      title: b.title,
      category: b.category,
      grabOffset: drawnGrab - drawnStartMin,
      durationMin: Math.max(15, b.endMin - b.startMin),
      date: b.date,
      startMin: b.startMin,
      originDate: b.date,
      originStart: b.startMin
    })
  }, [])

  useEffect(() => {
    if (!drag) return

    const onMove = (e: MouseEvent): void => {
      const grid = gridRef.current
      if (!grid) return
      const rect = grid.getBoundingClientRect()

      // 纵向：屏幕 Y → 绘制分钟 → 真实分钟
      const drawnGrab = ((e.clientY - rect.top) / HOUR_H) * 60
      const drawnStart = drawnGrab - drag.grabOffset
      const startMin = clampMinutes(
        snapToStep(layout.toReal(drawnStart), 15),
        0,
        24 * 60 - drag.durationMin
      )

      // 横向：落在哪一列
      const colW = rect.width / 7
      const idx = Math.max(0, Math.min(6, Math.floor((e.clientX - rect.left) / colW)))
      const date = days[idx].key

      setDrag({ ...drag, startMin, date })
    }

    const onUp = (): void => {
      const d = drag
      setDrag(null)
      // 原地没动就不写盘：否则「点一下就松手」会把时间悄悄改掉
      if (!d || (d.date === d.originDate && d.startMin === d.originStart)) return
      void window.api.task.update(d.id, {
        date: d.date,
        startTime: minutesToTime(d.startMin),
        endTime: minutesToTime(d.startMin + d.durationMin)
      })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, days, layout])

  // 打开时滚到 07:00；切换周时保持当前滚动位置（不重置，避免跳动）
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_H
  }, [])

  const isThisWeek = weekStartKey <= today && today <= to

  return (
    <div className={styles.root}>
      {/* 顶栏同时是窗口拖拽区（macOS 无原生标题栏）。
          交互控件由 global.css 的 [data-drag] 规则自动退出拖拽区。 */}
      <header className={styles.bar} data-drag="1">
        <div className={styles.barLeft}>
          <button className={styles.navBtn} onClick={() => setAnchor(addDays(weekStartKey, -7))} aria-label={t('上一周')}>
            ‹
          </button>
          {/*
            ⭐ 日期区间本身就是日历入口。
               之前只有左下角那个不起眼的小格子能点，用户根本没发现这里有日历；
               现在顶栏的日期和左下角日期格**都**能唤出同一个面板。
          */}
          <button
            className={styles.rangeBtn}
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-label={t('选择日期')}
            title={t('选择日期')}
          >
            {rangeText(from, to, lang)}
          </button>
          <button className={styles.navBtn} onClick={() => setAnchor(addDays(weekStartKey, 7))} aria-label={t('下一周')}>
            ›
          </button>
          <button
            className={styles.todayBtn}
            data-active={isThisWeek ? 'true' : 'false'}
            onClick={() => setAnchor(today)}
          >
            {t('本周')}
          </button>
        </div>

        <div className={styles.barRight}>
          <span className={styles.total}>
            {t('本周专注 {n} 个番茄', { n: weekFocusCount })}
          </span>
        </div>
      </header>

      {/* ---------------- 表头行 ---------------- */}
      <div className={styles.headRow}>
        {/* 左上角：日历入口 */}
        <button
          className={styles.corner}
          onClick={() => setPickerOpen((v) => !v)}
          title={t('点击选择日期')}
          aria-expanded={pickerOpen}
          data-testid="corner-date"
        >
          <span className={styles.cornerDate}>{from}</span>
        </button>

        {days.map((d) => (
          /*
           * ⭐ 表头的每一天都是「进入那一天」的入口，过去的日期同样能进。
           *    早先这里是个纯 div —— 点任何一天都没反应，用户想回看
           *    「前几天的安排」时发现点不动（用户实测反馈）。
           *    改成 button：点一下就把日视图切到那一天。
           *    注意**不做**「今天之后/之前」的过滤：翻旧账和看未来一样是刚需。
           */
          <button
            key={d.key}
            type="button"
            className={styles.headCell}
            data-today={d.key === today ? 'true' : 'false'}
            onClick={() => {
              setSelectedDate(d.key)
              setView('day')
            }}
            title={t('查看这一天的安排')}
            data-testid={`week-head-${d.key}`}
          >
            <span className={styles.headName}>{weekdayLabel(d.dow, lang, lang === 'zh')}</span>
            <span className={styles.headDate}>
              {Number(d.key.slice(5, 7))}/{Number(d.key.slice(8, 10))}
            </span>
          </button>
        ))}
      </div>

      {/* ---------------- 时间网格（纵向滚动） ---------------- */}
      <div className={styles.scroll} ref={scrollRef}>
        {/* ⚠️ 高度用撑开后的总长（> 24 小时）—— 刻度被拉长，轴线也要跟着变长 */}
        <div className={styles.rail} style={{ height: yOfReal(24 * 60) }}>
          {/*
            刻度列：绝对定位 + yOfReal。
            ⭐ 这是「同一时间段的时间轴也要拉长」的落点 ——
               某天 09:00–10:00 塞了两个事件，这一段变高，
               下面的 10:00 / 11:00 刻度整体下移，而不是固定等距。
          */}
          <div className={styles.gutter}>
            {HOURS.map((h) => (
              <span key={h} className={styles.gutterLabel} style={{ top: yOfReal(h * 60) }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
            {/* 收尾的 24:00，让轴线明确闭合到一天结束 */}
            <span className={styles.gutterLabel} style={{ top: yOfReal(24 * 60) }}>
              24:00
            </span>
          </div>

          <div className={styles.grid} ref={gridRef}>
            {HOURS.map((h) => (
              <div key={h} className={styles.hourLine} style={{ top: yOfReal(h * 60) }} />
            ))}

            {days.map((d) => {
              const list = blocksByDay.get(d.key) ?? []
              return (
                <div key={d.key} className={styles.col} data-today={d.key === today ? 'true' : 'false'}>
                  {list.map((b) => {
                    const shift = stack.get(b.id)
                    const startMin = shift?.startMin ?? b.startMin
                    const endMin = shift?.endMin ?? b.endMin
                    const isPending = b.pending === true
                    const dragging = drag?.id === b.id
                    return (
                      <div
                        key={b.id}
                        className={styles.block}
                        data-cat={b.category}
                        data-pending={isPending ? 'true' : 'false'}
                        data-dragging={dragging ? 'true' : 'false'}
                        style={{
                          top: yOfDrawn(startMin),
                          height: Math.max(16, yOfDrawn(endMin) - yOfDrawn(startMin))
                        }}
                        title={`${b.title} · ${t(CATEGORY_LABEL[b.category])}`}
                        /* ⭐ 拖动：纵向改时间、横向改日期 */
                        onMouseDown={(e) => beginDrag(e, b, startMin)}
                        /*
                         * ⭐ 用户要求：周视图的事件块右键也能删除，
                         *    且必须和日视图是同一套菜单（编辑 / 删除 + 二次确认）。
                         *    这里复用 useUIStore 的 blockMenu，菜单组件全局只挂一份。
                         */
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          openBlockMenu({
                            blockId: b.id,
                            kind: 'task',
                            taskId: null,
                            title: b.title,
                            x: e.clientX,
                            y: e.clientY,
                            // 重复实例的「只删这一次」需要日期与重复规则
                            date: b.date,
                            repeat: b.repeat
                          })
                        }}
                      >
                        <span className={styles.blockTitle}>{b.title}</span>
                        <ConfirmDot
                          pending={isPending}
                          confirming={confirmingId === b.id}
                          onConfirm={() => void confirmPending(b.id)}
                          title={t('点击确认这条日程')}
                        />
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {/*
              拖拽浮层：跟随指针的那一块。
              ⚠️ 不把原块在 7 列之间搬家 —— React 会在多个数组里反复插拔，
                 视觉上抖得很明显。原地那块压暗即可。
            */}
            {drag && (
              <div className={styles.dragLayer}>
                <div
                  className={styles.block}
                  data-cat={drag.category}
                  data-pending="false"
                  style={{
                    left: `${(days.findIndex((d) => d.key === drag.date) / 7) * 100}%`,
                    width: `${100 / 7}%`,
                    top: yOfReal(drag.startMin),
                    height: Math.max(16, (drag.durationMin / 60) * HOUR_H)
                  }}
                >
                  <span className={styles.blockTitle}>{drag.title}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 空状态不遮挡网格，只做一层轻提示 */}
        {totalBlocks === 0 && (
          <div className={styles.emptyOverlay}>
            <EmptyState
              icon={<IconWeek size={26} />}
              title={t('这一周还没有安排')}
              desc={t('在日视图里排好任务后，这里会显示整周的时间分布。')}
              action={{ label: t('去日视图'), onClick: () => setView('day') }}
            />
          </div>
        )}
      </div>

      {pickerOpen && (
        <CalendarPanel
          anchorDate={anchor}
          mode="week"
          weekStartsOn={weekStartsOn}
          today={today}
          onPick={(date) => setAnchor(date)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * 周区间文案。中文用 ISO 区间，英文用 `Oct 12 – Oct 18`。
 * ⚠️ 英文语序与中文不同，不能靠词典拼接，故单独处理。
 */
function rangeText(from: string, to: string, lang: 'zh' | 'en'): string {
  if (lang === 'zh') return `${from} ~ ${to}`
  const m0 = Number(to.slice(5, 7)) - 1
  return `${monthLabel(m0, lang)} ${Number(from.slice(8, 10))} – ${monthLabel(m0, lang)} ${Number(to.slice(8, 10))}`
}

export { dateToKey }
