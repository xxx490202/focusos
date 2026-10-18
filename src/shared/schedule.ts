// ============================================================
//  schedule.ts — 纯函数：时间↔分钟互转、重复规则展开、重叠检测
// ============================================================
//  本模块无任何 IO、无 Date.now() 依赖，
//  因此可完整单测。禁止 import electron。
// ============================================================

import type { Task, RepeatRule, Category, MonthlyMode } from './types'

// ============================================================
//  1. 'HH:mm' ↔ 分钟
// ============================================================

/** 'HH:mm' → 从 00:00 起的分钟数。非法输入返回 null */
export function timeToMinutes(time: string | undefined): number | null {
  if (!time) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null
  if (h < 0 || h > 24 || min < 0 || min > 59) return null
  return h * 60 + min
}

/** 分钟数 → 'HH:mm'（含负数与越界夹取） */
export function minutesToTime(minutes: number): string {
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 秒 → 'MM:SS'（超过 99 分钟仍正常显示，如 150:00） */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** 15 分钟吸附（负方向同样吸附）。结果归一化 -0 → 0 */
export function snapToStep(minutes: number, step = 15): number {
  const snapped = Math.round(minutes / step) * step
  return snapped === 0 ? 0 : snapped
}

/** 把分钟夹取到 [min, max] */
export function clampMinutes(minutes: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, minutes))
}

// ============================================================
//  2. 日期工具（不引date-fns 也能测的最小实现，
//    渲染层/主进程复杂格式化再用 date-fns）
// ============================================================

/** 'YYYY-MM-DD' → UTC 零点 Date，避免本地时区漂移 */
export function dateToUTC(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}

export function dateToKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(date: string, days: number): string {
  const d = dateToUTC(date)
  d.setUTCDate(d.getUTCDate() + days)
  return dateToKey(d)
}

/** 0=周日 … 6=周六 */
export function dayOfWeek(date: string): number {
  return dateToUTC(date).getUTCDay()
}

/** 含首尾的日期区间 */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  // 防御性上限，防止误传导致的死循环
  for (let i = 0; i < 3660 && cur <= to; i++) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

/** 某日期所在周的起始日（weekStartsOn: 0=周日 1=周一） */
export function startOfWeek(date: string, weekStartsOn: 0 | 1 = 1): string {
  const dow = dayOfWeek(date)
  const diff = (dow - weekStartsOn + 7) % 7
  return addDays(date, -diff)
}

export function isToday(date: string, today: string): boolean {
  return date === today
}

// ---------------- 月历（周视图的日历选择器用） ----------------

/** 星期几的中文简称，下标与 Date.getDay() 对齐（0=周日） */
export const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 完整写法，表头用（周一 / 周二 …） */
export const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/**
 * 按「周起始日」排出的 7 个星期下标。
 * weekStartsOn=1 → [1,2,3,4,5,6,0]（周一在前）
 */
export function weekdayOrder(weekStartsOn: 0 | 1 = 1): number[] {
  return Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7)
}

/**
 * 月历网格：固定 6 行 × 7 列 = 42 个日期键。
 *
 * ⚠️ 固定 42 格而不是「按需 4~6 行」：月份切换时行数变化会让整个面板跳动，
 *    固定高度后上下滚动浏览多个月才不会抖。
 *
 * @param year        年
 * @param month0      月（0–11，与 Date.getMonth() 一致）
 * @param weekStartsOn 0=周日开头，1=周一开头
 */
export function monthGrid(year: number, month0: number, weekStartsOn: 0 | 1 = 1): string[] {
  // ⚠️ 全程走 UTC，禁止混入本地时间构造。
  //    dateToKey() 读的是 getUTC* 字段，若这里用 new Date(y, m, 1)（本地），
  //    在 GMT+8 这类时区下本地零点落在前一天的 UTC 16:00，整张网格会**整体差一天**。
  const first = new Date(Date.UTC(year, month0, 1))
  // 网格第一格 = 包含 1 号的那一周的起始日；1 - offset 为负时 Date.UTC 会自动回退上个月
  const offset = (first.getUTCDay() - weekStartsOn + 7) % 7
  const start = Date.UTC(year, month0, 1 - offset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    return dateToKey(d)
  })
}

/** 该日期是否属于指定年月（用于月历里区分「本月」与「补位日」） */
export function isSameMonth(date: string, year: number, month0: number): boolean {
  const d = dateToUTC(date)
  return d.getUTCFullYear() === year && d.getUTCMonth() === month0
}

/**
 * 时间戳 → 本地时区的 'YYYY-MM-DD'。
 * ⚠️ 统计按「用户所在时区的自然日」归集，因此这里刻意用本地时间，
 *    与上面按 UTC 计算的纯日期运算（dateToUTC/dateRange）区分开。
 */
export function dateKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ============================================================
//  3. 重复规则展开
// ============================================================

/** 两个日期相差的整天数（date >= anchor，所以恒为非负） */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateToUTC(to).getTime() - dateToUTC(from).getTime()) / 86_400_000)
}

/** 相差的整周数（向下取整） */
function weeksBetween(from: string, to: string): number {
  return Math.floor(daysBetween(from, to) / 7)
}

/** 相差的整月数（不足一个月记 0） */
function monthsBetween(from: string, to: string): number {
  const a = dateToUTC(from)
  const b = dateToUTC(to)
  const raw = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  // 号数还没到 → 不算满一个月（3/15 → 4/14 是 0 个月）
  return b.getUTCDate() >= a.getUTCDate() ? raw : raw - 1
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

/** 该日期是当月第几个「这个星期几」（1..5） */
function nthWeekdayInMonth(d: Date): number {
  return Math.floor((d.getUTCDate() - 1) / 7) + 1
}

/** 该日期是不是当月**最后**一个「这个星期几」 */
function isLastWeekdayInMonth(d: Date): boolean {
  return d.getUTCDate() + 7 > daysInMonth(d.getUTCFullYear(), d.getUTCMonth())
}

/**
 * 判断某个具体日期是否命中重复规则。
 *
 * 支持的规则：
 * · daily / weekdays / weekly / monthly 四种基础周期
 * · repeatEvery = 每隔 n 个周期（daily 按天、weekly 按周、monthly 按月）
 * · monthlyMode = date（同号）/ nthWeekday（每月第 N 个星期几）/ lastDay（每月最后一天）
 * · deletedInstanceDates = 单日例外（删掉某一次，不影响整条系列）
 */
export function matchesRepeat(task: Task, date: string): boolean {
  const rule: RepeatRule = task.repeat
  if (rule === 'none') return task.date === date
  // 未指定起始日期的循环任务：从今天起算
  const anchor = task.date
  if (!anchor) return false
  if (date < anchor) return false
  if (task.repeatUntil && date > task.repeatUntil) return false
  // ⭐ 单日例外：用户把这天的这一次单独删掉了
  if (task.deletedInstanceDates?.includes(date)) return false

  const every = Math.max(1, Math.floor(task.repeatEvery ?? 1))
  const dow = dayOfWeek(date)

  switch (rule) {
    case 'daily':
      // every=1 时恒真（daysBetween % 1 === 0），行为与改造前完全一致
      return daysBetween(anchor, date) % every === 0
    case 'weekdays':
      return dow >= 1 && dow <= 5
    case 'weekly':
      if (dow !== dayOfWeek(anchor)) return false
      return weeksBetween(anchor, date) % every === 0
    case 'monthly': {
      const mode: MonthlyMode = task.monthlyMode ?? 'date'
      const d = dateToUTC(date)

      if (mode === 'lastDay') {
        return d.getUTCDate() === daysInMonth(d.getUTCFullYear(), d.getUTCMonth())
      }

      if (mode === 'nthWeekday') {
        const target = task.monthlyWeekday
        const nth = task.monthlyWeekOfMonth
        if (target === undefined || nth === undefined) return false
        if (d.getUTCDay() !== ((target % 7) + 7) % 7) return false
        if (nth === -1) return isLastWeekdayInMonth(d)
        return nthWeekdayInMonth(d) === nth
      }

      // date 模式：同号 + 相隔 n 个月
      if (d.getUTCDate() !== dateToUTC(anchor).getUTCDate()) return false
      return monthsBetween(anchor, date) % every === 0
    }
    default:
      return false
  }
}

/**
 * 把循环任务展开成区间内的实例。
 * 只渲染当前视图区间内的实例，不落盘。
 *
 * @param today 传入时才会应用 skipOverdue（不展开已经过去的日子）。
 *              ⚠️ 刻意做成参数而不是内部取 Date.now()：
 *              本模块要保持「无时钟依赖」才能完整单测。
 */
export function expandRepeatingTasks(
  tasks: Task[],
  from: string,
  to: string,
  today?: string
): Task[] {
  const out: Task[] = []
  for (const task of tasks) {
    if (task.repeat === 'none' || !task.date) {
      if (task.date && task.date >= from && task.date <= to) out.push(task)
      continue
    }
    for (const day of dateRange(from, to)) {
      // 跳过已过期的实例：月视图里重复任务会把整个月过去的日子铺满，
      // 看着像一堆欠账（用户要求可关掉这种铺法）
      if (task.skipOverdue && today && day < today) continue
      if (matchesRepeat(task, day)) {
        // 用实例日期覆盖 date，保证时间轴按天取到正确实例
        out.push({ ...task, id: `${task.id}@${day}`, date: day })
      }
    }
  }
  return out
}

// ============================================================
//  4. 时间轴块（任务 + 计划块统一抽象）
// ============================================================

export interface TimeBlock {
  id: string
  taskId: string
  title: string
  date: string
  /** 从 00:00 起的分钟数 */
  startMin: number
  endMin: number
  category: Category
  priority: Task['priority']
  status: Task['status']
  kind: 'task' | 'plan'
  phase?: 'focus' | 'shortBreak' | 'longBreak'
  repeat: RepeatRule
  /**
   * 待确认：该块尚未被用户落定为正式日程。
   * 时间轴上以灰字 + 右侧空心圆呈现；计划块永远不是待确认。
   */
  pending?: boolean
}

export function blockOfTask(task: Task, fallbackMinutes = 60): TimeBlock | null {
  if (!task.date || !task.startTime) return null
  const startMin = timeToMinutes(task.startTime)
  if (startMin === null) return null
  const endMin = timeToMinutes(task.endTime)
  const dur = endMin !== null && endMin > startMin ? endMin - startMin : fallbackMinutes
  return {
    id: task.id,
    taskId: task.id,
    title: task.title,
    date: task.date,
    startMin,
    endMin: startMin + dur,
    category: task.category,
    priority: task.priority,
    status: task.status,
    kind: 'task',
    repeat: task.repeat,
    pending: task.pending === true
  }
}

export function blocksOverlap(
  a: { startMin: number; endMin: number },
  b: { startMin: number; endMin: number }
): boolean {
  // 半开区间：相接不算重叠
  return a.startMin < b.endMin && b.startMin < a.endMin
}

/** 返回与 block 重叠的其他块 id 集合 */
export function findConflicts(blocks: TimeBlock[]): Set<string> {
  const conflicted = new Set<string>()
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[i].date !== blocks[j].date) continue
      if (blocksOverlap(blocks[i], blocks[j])) {
        conflicted.add(blocks[i].id)
        conflicted.add(blocks[j].id)
      }
    }
  }
  return conflicted
}

/**
 * 重叠分栏：同一组互相重叠的块左右排开。
 * 返回每个块 → { col, cols }（cols 为该重叠簇的总列数）
 */
export function layoutColumns(
  blocks: TimeBlock[]
): Map<string, { col: number; cols: number }> {
  const byDate = new Map<string, TimeBlock[]>()
  for (const b of blocks) {
    const list = byDate.get(b.date)
    if (list) list.push(b)
    else byDate.set(b.date, [b])
  }

  const out = new Map<string, { col: number; cols: number }>()

  for (const list of byDate.values()) {
    const sorted = [...list].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
    // 贪心分簇：与当前簇任一块重叠即加入
    let cluster: TimeBlock[] = []
    let clusterEnd = -Infinity

    const flush = () => {
      if (cluster.length === 0) return
      // 组内贪心分配列
      const colEnds: number[] = []
      const assign = new Map<string, number>()
      for (const b of cluster) {
        let col = colEnds.findIndex((end) => end <= b.startMin)
        if (col === -1) {
          col = colEnds.length
          colEnds.push(b.endMin)
        } else {
          colEnds[col] = b.endMin
        }
        assign.set(b.id, col)
      }
      const cols = colEnds.length
      for (const [id, col] of assign) out.set(id, { col, cols })
      cluster = []
      clusterEnd = -Infinity
    }

    for (const b of sorted) {
      if (cluster.length > 0 && b.startMin >= clusterEnd) flush()
      cluster.push(b)
      clusterEnd = Math.max(clusterEnd, b.endMin)
    }
    flush()
  }

  return out
}

/**
 * 时间轴上「一行」的绘制区间。
 * 与块自身的 startMin/endMin 可能不同 —— 那是纯展示调整，绝不写回任务。
 */
export interface DisplayBlock {
  startMin: number
  endMin: number
}

/**
 * 时间轴排版结果。
 * ⚠️ 有了它，刻度列 / 网格线 / 当前时间线才能和块对齐 ——
 *    块被撑高或下移之后，「左边的时间」必须跟着一起走，
 *    否则块在 10:00 的位置、左边的 10:00 却还在原地，两者对不上。
 */
export interface TimelineLayout {
  /** 块 id → 绘制区间（分钟，已含撑高与堆叠位移） */
  blocks: Map<string, DisplayBlock>
  /** 真实分钟 → 绘制分钟 */
  toDrawn: (realMin: number) => number
  /** 绘制分钟 → 真实分钟（拖拽落点 / 双击新建必须用它反算） */
  toReal: (drawnMin: number) => number
  /** 撑开后的整天长度（分钟），可能大于 1440 */
  drawnTotal: number
}

/**
 * 时间轴排版：保证每个块都画得下自己的内容，并给出配套的时间轴映射。
 *
 * ⭐ 用户规则（都来自实测反馈）：
 *    1. 「框子大小也要一致，拉长那个时间段的高度」
 *       自然高度不足 minMinutes 的块（最典型是 25 分钟的番茄计划块）
 *       一律按 minMinutes 绘制 —— 宁可把这一段撑高，也不把标题/时间挤掉。
 *    2. 「第二个事件排在上一个事件下方」+「左边时间轴也要跟着拉高」
 *       撑高 / 撞车产生的重叠**不左右分栏**，而是整块下移；
 *       并且**整条时间轴按同样的位移一起拉伸** —— 09:00–10:00 那一段
 *       装了两个事件，它下面直到 10:00 刻度的距离就变成两格高。
 *       待确认块排在已确认块之后占位，保证它总落在下方。
 *
 * 只在同一天内推演；不改变任何数据。
 *
 * @param minMinutes 该视图下「能完整显示一个块」所需的最少分钟数
 */
export function layoutTimeline(blocks: TimeBlock[], minMinutes: number): TimelineLayout {
  const laid = new Map<string, DisplayBlock>()
  const extras: { at: number; extra: number }[] = []

  const byDate = new Map<string, TimeBlock[]>()
  for (const b of blocks) {
    const list = byDate.get(b.date)
    if (list) list.push(b)
    else byDate.set(b.date, [b])
  }

  const byStart = (a: TimeBlock, b: TimeBlock): number =>
    a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  for (const list of byDate.values()) {
    const ordered = [
      ...list.filter((b) => !b.pending).sort(byStart),
      ...list.filter((b) => b.pending).sort(byStart)
    ]

    /** 该日期内累计的额外位移（分钟） */
    let shift = 0
    /** 上一个块的绘制结束位置，用于把重叠的块顶下去 */
    let cursor = -Infinity

    for (const b of ordered) {
      const dur = Math.max(1, b.endMin - b.startMin)
      const drawnDur = Math.max(dur, minMinutes)
      const drawnStart = Math.max(b.startMin + shift, cursor)
      const drawnEnd = drawnStart + drawnDur
      cursor = drawnEnd
      laid.set(b.id, { startMin: drawnStart, endMin: drawnEnd })

      // 这一段比「按原时间本该占的高度」多出来的部分，要顺延给它之后的整条时间轴
      const extra = drawnEnd - (b.endMin + shift)
      if (extra > 0) {
        shift += extra
        extras.push({ at: b.endMin, extra })
      }
    }
  }

  /*
   * 把「哪一刻往后要额外顺延多少」整理成单调不减的阶梯。
   * 同一真实时刻的多个额外量合并；正午之前没有额外量时阶梯就是空的，
   * 此时映射退化成恒等（块没被撑高/堆叠的普通日子完全不受影响）。
   */
  extras.sort((a, b) => a.at - b.at)
  const steps: { at: number; shift: number }[] = []
  let acc = 0
  for (const e of extras) {
    acc += e.extra
    const last = steps[steps.length - 1]
    if (last && last.at === e.at) last.shift = acc
    else steps.push({ at: e.at, shift: acc })
  }

  const toDrawn = (realMin: number): number => {
    let shift = 0
    for (const st of steps) {
      if (st.at <= realMin) shift = st.shift
      else break
    }
    return realMin + shift
  }

  const toReal = (drawnMin: number): number => {
    let shift = 0
    for (const st of steps) {
      // st.at + shift 是「本段在绘制空间的终点」，越过它就换用下一段的位移
      if (drawnMin < st.at + shift) break
      shift = st.shift
    }
    return Math.max(0, Math.min(24 * 60, drawnMin - shift))
  }

  return { blocks: laid, toDrawn, toReal, drawnTotal: toDrawn(24 * 60) }
}

/**
 * 只取块位置的便捷包装（周视图不需要可变时间轴，用不到映射）。
 */
export function layoutTimelineDisplay(
  blocks: TimeBlock[],
  minMinutes: number
): Map<string, DisplayBlock> {
  return layoutTimeline(blocks, minMinutes).blocks
}

/**
 * 给未指定时间的新任务挑一个默认时段。
 * 从 nowMinutes 起按 step 向上取整，逐个候选往后推，跳过所有已占用区间。
 * 全天都排满时退回当日末尾（宁可重叠也要给个落点，用户可再拖动）。
 */
export function nextFreeSlot(
  occupied: { startMin: number; endMin: number }[],
  durationMin: number,
  nowMinutes: number,
  step = 15
): { startMin: number; endMin: number } {
  const limit = 24 * 60
  const dur = Math.max(step, durationMin)
  let start = Math.ceil(nowMinutes / step) * step
  while (start + dur <= limit) {
    const end = start + dur
    if (!occupied.some((o) => o.startMin < end && start < o.endMin)) {
      return { startMin: start, endMin: end }
    }
    start += step
  }
  const fallback = Math.max(0, limit - dur)
  return { startMin: fallback, endMin: limit }
}

// ============================================================
//  5. 勿扰时段
// ============================================================

/** from > to 视为跨零点，如 22:00–08:00 */
export function isInDnd(minutes: number, from: string, to: string): boolean {
  const f = timeToMinutes(from)
  const t = timeToMinutes(to)
  if (f === null || t === null) return false
  if (f === t) return false
  if (f < t) return minutes >= f && minutes < t
  // 跨零点
  return minutes >= f || minutes < t
}

/** 区间 [startMin, endMin) 是否完全落在勿扰时段内 */
export function rangeHitsDnd(startMin: number, endMin: number, from: string, to: string): boolean {
  const f = timeToMinutes(from)
  const t = timeToMinutes(to)
  if (f === null || t === null) return false
  if (f === t) return false
  if (f < t) {
    return startMin >= f && endMin <= t
  }
  return (startMin >= f && endMin <= 24 * 60) || (startMin >= 0 && endMin <= t)
}

/**
 * 区间 [startMin, endMin) 是否与勿扰时段**有任何交集**。
 * 计划生成用这个更严格的判据：宁可少排，也不能让任何番茄
 * 哪怕只侵入勿扰 1 分钟。
 */
export function rangeIntersectsDnd(
  startMin: number,
  endMin: number,
  from: string,
  to: string
): boolean {
  const f = timeToMinutes(from)
  const t = timeToMinutes(to)
  if (f === null || t === null || f === t) return false
  const s = startMin
  const e = endMin

  if (f < t) {
    // 同日勿扰 [f, t)
    return s < t && f < e
  }
  // 跨零点：[f, 1440) ∪ [0, t)
  const hitsLate = s < 24 * 60 && f < e
  const hitsEarly = s < t && 0 < e
  return hitsLate || hitsEarly
}

// ============================================================
//  6. 统计聚合
// ============================================================

export interface StatRange {
  from: string
  to: string
}

export function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0)
}

export function average(nums: number[]): number {
  return nums.length === 0 ? 0 : sum(nums) / nums.length
}

/** 安全除法，避免 NaN 出现在界面上 */
export function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.round((total % 3600) / 60)
  if (h === 0) return `${m} 分钟`
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分`
}

/** 番茄节律三段划分：上午 <12:00，下午 12:00–18:00，晚间 ≥18:00 */
export type Daypart = 'morning' | 'afternoon' | 'evening'

export function daypartOf(minutes: number): Daypart {
  if (minutes < 12 * 60) return 'morning'
  if (minutes < 18 * 60) return 'afternoon'
  return 'evening'
}
