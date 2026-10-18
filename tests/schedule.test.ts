// ============================================================
//  schedule 纯函数单测
// ============================================================
import { describe, it, expect } from 'vitest'
import {
  timeToMinutes,
  minutesToTime,
  formatClock,
  snapToStep,
  clampMinutes,
  addDays,
  dateRange,
  monthGrid,
  weekdayOrder,
  isSameMonth,
  WEEKDAY_CN,
  startOfWeek,
  dayOfWeek,
  matchesRepeat,
  expandRepeatingTasks,
  blocksOverlap,
  findConflicts,
  layoutColumns,
  layoutTimeline,
  layoutTimelineDisplay,
  nextFreeSlot,
  blockOfTask,
  isInDnd,
  rangeHitsDnd,
  ratio,
  average,
  formatDuration,
  daypartOf
} from '@shared/schedule'
import { makeTask } from '@shared/defaults'
import type { TimeBlock } from '@shared/schedule'

describe('时间 ↔ 分钟互转', () => {
  it('解析 HH:mm', () => {
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('23:59')).toBe(1439)
  })

  it('非法输入返回 null', () => {
    expect(timeToMinutes(undefined)).toBeNull()
    expect(timeToMinutes('')).toBeNull()
    expect(timeToMinutes('abc')).toBeNull()
    expect(timeToMinutes('25:00')).toBeNull()
    expect(timeToMinutes('10:75')).toBeNull()
  })

  it('分钟转 HH:mm 并夹取越界', () => {
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(570)).toBe('09:30')
    expect(minutesToTime(-30)).toBe('00:00')
    expect(minutesToTime(9999)).toBe('24:00')
  })

  it('往返一致', () => {
    for (const t of ['00:00', '07:15', '13:45', '23:59']) {
      expect(minutesToTime(timeToMinutes(t)!)).toBe(t)
    }
  })

  it('秒格式化', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(61)).toBe('01:01')
    expect(formatClock(1500)).toBe('25:00')
    expect(formatClock(-5)).toBe('00:00')
  })
})

describe('吸附与夹取', () => {
  it('15 分钟吸附', () => {
    expect(snapToStep(0)).toBe(0)
    expect(snapToStep(7)).toBe(0)
    expect(snapToStep(8)).toBe(15)
    expect(snapToStep(22)).toBe(15)
    expect(snapToStep(23)).toBe(30)
    expect(snapToStep(-7)).toBe(0)
    expect(snapToStep(-8)).toBe(-15)
  })

  it('夹取到区间', () => {
    expect(clampMinutes(-10, 0, 1440)).toBe(0)
    expect(clampMinutes(2000, 0, 1440)).toBe(1440)
    expect(clampMinutes(500, 0, 1440)).toBe(500)
  })
})

describe('日期工具', () => {
  it('跨月跨年加天', () => {
    expect(addDays('2026-10-14', 1)).toBe('2026-10-15')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    // 闰年
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('区间含首尾', () => {
    expect(dateRange('2026-10-14', '2026-10-16')).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16'
    ])
    expect(dateRange('2026-10-14', '2026-10-14')).toEqual(['2026-10-14'])
    expect(dateRange('2026-10-16', '2026-10-14')).toEqual([])
  })

  it('周起始日', () => {
    // 2026-10-14 是周三
    expect(dayOfWeek('2026-10-14')).toBe(3)
    expect(startOfWeek('2026-10-14', 1)).toBe('2026-10-12') // 周一
    expect(startOfWeek('2026-10-14', 0)).toBe('2026-10-11') // 周日
  })
})

describe('重复规则展开', () => {
  const daily = makeTask({ title: 'd', date: '2026-10-12', repeat: 'daily' })

  it('daily 命中区间内每一天', () => {
    expect(matchesRepeat(daily, '2026-10-14')).toBe(true)
    expect(matchesRepeat(daily, '2026-10-11')).toBe(false) // 早于锚点
    expect(addDays('2026-10-12', 30)).toBe('2026-11-11')
    expect(matchesRepeat(daily, '2026-11-11')).toBe(true)
  })

  it('repeatUntil 之后不再命中', () => {
    const t = makeTask({ date: '2026-10-12', repeat: 'daily', repeatUntil: '2026-10-14' })
    expect(matchesRepeat(t, '2026-10-14')).toBe(true)
    expect(matchesRepeat(t, '2026-10-15')).toBe(false)
  })

  it('weekdays 跳过周末', () => {
    const t = makeTask({ date: '2026-10-12', repeat: 'weekdays' })
    expect(matchesRepeat(t, '2026-10-16')).toBe(true) // 周五
    expect(matchesRepeat(t, '2026-10-17')).toBe(false) // 周六
    expect(matchesRepeat(t, '2026-10-18')).toBe(false) // 周日
    expect(matchesRepeat(t, '2026-10-19')).toBe(true) // 周一
  })

  it('weekly 只命中同一星期几', () => {
    const t = makeTask({ date: '2026-10-14', repeat: 'weekly' }) // 周三
    expect(matchesRepeat(t, '2026-10-14')).toBe(true)
    expect(matchesRepeat(t, '2026-10-21')).toBe(true)
    expect(matchesRepeat(t, '2026-10-15')).toBe(false)
  })

  it('monthly 只命中同一日号', () => {
    const t = makeTask({ date: '2026-10-14', repeat: 'monthly' })
    expect(matchesRepeat(t, '2026-11-14')).toBe(true)
    expect(matchesRepeat(t, '2026-11-15')).toBe(false)
  })

  it('展开只返回视图区间内的实例，且 id 带实例日期', () => {
    const out = expandRepeatingTasks([daily], '2026-10-14', '2026-10-16')
    expect(out).toHaveLength(3)
    expect(out.map((t) => t.date)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16'])
    expect(out[0].id).toBe(`${daily.id}@2026-10-14`)
  })

  it('非循环任务原样返回', () => {
    const once = makeTask({ date: '2026-10-15', repeat: 'none' })
    const out = expandRepeatingTasks([once], '2026-10-14', '2026-10-16')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe(once.id)
  })

  it('收件箱任务（date=null）不进入时间轴', () => {
    const inbox = makeTask({ repeat: 'daily' })
    expect(expandRepeatingTasks([inbox], '2026-10-14', '2026-10-16')).toHaveLength(0)
  })
})

describe('重叠检测与分栏', () => {
  const mk = (id: string, startMin: number, endMin: number, date = '2026-10-14'): TimeBlock => ({
    id,
    taskId: id,
    title: id,
    date,
    startMin,
    endMin,
    category: 'work',
    priority: 1,
    status: 'todo',
    kind: 'task',
    repeat: 'none'
  })

  it('相接不算重叠', () => {
    expect(blocksOverlap({ startMin: 540, endMin: 600 }, { startMin: 600, endMin: 660 })).toBe(false)
    expect(blocksOverlap({ startMin: 540, endMin: 620 }, { startMin: 600, endMin: 660 })).toBe(true)
    expect(blocksOverlap({ startMin: 540, endMin: 560 }, { startMin: 540, endMin: 560 })).toBe(true)
  })

  it('找出冲突块', () => {
    const blocks = [mk('a', 540, 600), mk('b', 570, 630), mk('c', 700, 760)]
    const c = findConflicts(blocks)
    expect(c.has('a')).toBe(true)
    expect(c.has('b')).toBe(true)
    expect(c.has('c')).toBe(false)
  })

  it('跨天不误判冲突', () => {
    const blocks = [mk('a', 540, 600, '2026-10-14'), mk('b', 540, 600, '2026-10-15')]
    expect(findConflicts(blocks).size).toBe(0)
  })

  it('重叠块分栏，宽度按比例收窄', () => {
    const layout = layoutColumns([mk('a', 540, 600), mk('b', 560, 620)])
    expect(layout.get('a')).toEqual({ col: 0, cols: 2 })
    expect(layout.get('b')).toEqual({ col: 1, cols: 2 })
  })

  it('不相交的块各自独占一列', () => {
    const layout = layoutColumns([mk('a', 540, 600), mk('b', 700, 760)])
    expect(layout.get('a')).toEqual({ col: 0, cols: 1 })
    expect(layout.get('b')).toEqual({ col: 0, cols: 1 })
  })

  it('三个互相重叠的块分三栏', () => {
    const layout = layoutColumns([mk('a', 540, 700), mk('b', 550, 700), mk('c', 560, 700)])
    expect(layout.get('a')?.cols).toBe(3)
    expect(layout.get('b')?.cols).toBe(3)
    expect(layout.get('c')?.cols).toBe(3)
  })
})

describe('勿扰时段', () => {
  it('同日区间', () => {
    expect(isInDnd(9 * 60, '08:00', '18:00')).toBe(true)
    expect(isInDnd(7 * 60, '08:00', '18:00')).toBe(false)
    expect(isInDnd(18 * 60, '08:00', '18:00')).toBe(false)
  })

  it('跨零点 22:00–08:00', () => {
    expect(isInDnd(23 * 60, '22:00', '08:00')).toBe(true)
    expect(isInDnd(3 * 60, '22:00', '08:00')).toBe(true)
    expect(isInDnd(12 * 60, '22:00', '08:00')).toBe(false)
    expect(isInDnd(8 * 60, '22:00', '08:00')).toBe(false)
  })

  it('from == to 视为不生效', () => {
    expect(isInDnd(500, '10:00', '10:00')).toBe(false)
  })

  it('区间完全落在勿扰内才算命中', () => {
    // 22:00–08:00 跨零点，23:00–23:30 落在 [22:00,24:00) 段内
    expect(rangeHitsDnd(23 * 60, 23 * 60 + 30, '22:00', '08:00')).toBe(true)
    // 02:00–03:00 落在 [0,08:00) 段内
    expect(rangeHitsDnd(2 * 60, 3 * 60, '22:00', '08:00')).toBe(true)
    // 跨越勿扰边界，不算命中
    expect(rangeHitsDnd(21 * 60, 23 * 60, '22:00', '08:00')).toBe(false)
    expect(rangeHitsDnd(7 * 60, 9 * 60, '22:00', '08:00')).toBe(false)
    // 同日勿扰区间
    expect(rangeHitsDnd(9 * 60, 10 * 60, '08:00', '18:00')).toBe(true)
    expect(rangeHitsDnd(17 * 60, 19 * 60, '08:00', '18:00')).toBe(false)
  })
})

describe('统计聚合', () => {
  it('安全除法不产生 NaN', () => {
    expect(ratio(0, 0)).toBe(0)
    expect(ratio(3, 4)).toBe(0.75)
  })

  it('平均值', () => {
    expect(average([])).toBe(0)
    expect(average([1, 2, 3])).toBe(2)
  })

  it('时长格式化', () => {
    expect(formatDuration(0)).toBe('0 分钟')
    expect(formatDuration(25 * 60)).toBe('25 分钟')
    expect(formatDuration(3600)).toBe('1 小时')
    expect(formatDuration(3660)).toBe('1 小时 1 分')
  })

  it('时段节律划分', () => {
    expect(daypartOf(9 * 60)).toBe('morning')
    expect(daypartOf(11 * 60 + 59)).toBe('morning')
    expect(daypartOf(12 * 60)).toBe('afternoon')
    expect(daypartOf(18 * 60)).toBe('evening')
    expect(daypartOf(23 * 60)).toBe('evening')
  })
})

// ============================================================
//  月历（周视图日历选择器用）
// ============================================================
describe('月历网格 monthGrid', () => {
  it('固定返回 42 格（6 周 × 7 天），月份切换时高度不跳', () => {
    for (const m of [0, 1, 5, 11]) {
      expect(monthGrid(2026, m)).toHaveLength(42)
    }
  })

  it('首格是包含 1 号的那一周的起始日（周一起始）', () => {
    // 2026-10-01 是周四 → 网格应从 2026-09-28（周一）开始
    const g = monthGrid(2026, 9, 1)
    expect(g[0]).toBe('2026-09-28')
  })

  it('周日起始时首格整体前移一天', () => {
    const g = monthGrid(2026, 9, 0)
    expect(g[0]).toBe('2026-09-27')
  })

  it('网格连续，无重复无断档', () => {
    const g = monthGrid(2026, 1, 1)
    for (let i = 1; i < g.length; i++) {
      expect(g[i]).toBe(addDays(g[i - 1], 1))
    }
  })

  it('必定覆盖整月（1 号与月末都在网格里）', () => {
    const g = monthGrid(2026, 1, 1) // 2026-02，非闰年 28 天
    expect(g).toContain('2026-02-01')
    expect(g).toContain('2026-02-28')
  })

  it('跨年边界正确（12 月的网格会带上次年 1 月）', () => {
    const g = monthGrid(2026, 11, 1)
    expect(g).toContain('2026-12-01')
    expect(g.some((k) => k.startsWith('2027-01'))).toBe(true)
  })
})

describe('星期排列 weekdayOrder', () => {
  it('周一起始：1,2,3,4,5,6,0', () => {
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('周日起始：0..6', () => {
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('与 WEEKDAY_CN 配合能拼出「周一…周日」且不重不漏', () => {
    const labels = weekdayOrder(1).map((d) => WEEKDAY_CN[d])
    expect(labels).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日'])
    expect(new Set(labels).size).toBe(7)
  })
})

describe('isSameMonth', () => {
  it('本月与补位日区分正确', () => {
    expect(isSameMonth('2026-10-01', 2026, 9)).toBe(true)
    expect(isSameMonth('2026-09-30', 2026, 9)).toBe(false)
    expect(isSameMonth('2026-11-01', 2026, 9)).toBe(false)
  })
})

// ============================================================
//  待确认日程（pending）
// ============================================================

function mkBlock(
  id: string,
  startMin: number,
  endMin: number,
  opts: { pending?: boolean; date?: string } = {}
): TimeBlock {
  return {
    id,
    taskId: id,
    title: id,
    date: opts.date ?? '2026-10-16',
    startMin,
    endMin,
    category: 'work',
    priority: 1,
    status: 'todo',
    kind: 'task',
    repeat: 'none',
    pending: opts.pending
  }
}

describe('blockOfTask — 待确认标记透传', () => {
  const base = {
    id: 't1',
    title: '写周报',
    date: '2026-10-16',
    startTime: '09:00',
    endTime: '10:00',
    priority: 1 as const,
    category: 'work' as const,
    tags: [],
    checklist: [],
    estimatedPomodoros: 1,
    completedPomodoros: 0,
    status: 'todo' as const,
    repeat: 'none' as const,
    createdAt: 0,
    updatedAt: 0
  }

  it('pending=true 时块上带 pending', () => {
    expect(blockOfTask({ ...base, pending: true })?.pending).toBe(true)
  })

  it('没有 pending 字段（旧数据）时视为已确认', () => {
    expect(blockOfTask({ ...base })?.pending).toBe(false)
  })
})

describe('layoutTimelineDisplay — 时间轴绘制排版', () => {
  it('放得下的块保持原位，时长不变', () => {
    const a = mkBlock('a', 540, 600) // 09:00–10:00，60 分钟
    const out = layoutTimelineDisplay([a], 36)
    expect(out.get('a')).toEqual({ startMin: 540, endMin: 600 })
  })

  it('不足最少高度的块被撑高（框大小保持一致，不裁文字）', () => {
    const plan = mkBlock('p', 660, 685) // 11:00–11:25，25 分钟番茄计划
    const out = layoutTimelineDisplay([plan], 36)
    expect(out.get('p')).toEqual({ startMin: 660, endMin: 696 })
  })

  it('撑高后与下一块相撞时，下一块整体下移（拉长该时段而不是分栏）', () => {
    const p1 = mkBlock('p1', 660, 685)
    const p2 = mkBlock('p2', 685, 710)
    const out = layoutTimelineDisplay([p1, p2], 36)
    expect(out.get('p1')).toEqual({ startMin: 660, endMin: 696 })
    expect(out.get('p2')).toEqual({ startMin: 696, endMin: 732 })
  })

  it('待确认块排在已确认块之后占位：即使时间更早也落在下方', () => {
    const pend = mkBlock('p', 540, 600, { pending: true })
    const done = mkBlock('c', 570, 630)
    const out = layoutTimelineDisplay([pend, done], 36)
    // 已确认的 c 先占 09:30–10:30
    expect(out.get('c')).toEqual({ startMin: 570, endMin: 630 })
    // 待确认的 p 被排到它下方
    expect(out.get('p')).toEqual({ startMin: 630, endMin: 690 })
  })

  it('时间不重叠的块互不影响', () => {
    const a = mkBlock('a', 540, 600)
    const b = mkBlock('b', 660, 720)
    const out = layoutTimelineDisplay([a, b], 36)
    expect(out.get('a')).toEqual({ startMin: 540, endMin: 600 })
    expect(out.get('b')).toEqual({ startMin: 660, endMin: 720 })
  })

  it('跨天各自推演，不互相挤压', () => {
    const a = mkBlock('a', 540, 575, { date: '2026-10-16' })
    const b = mkBlock('b', 540, 575, { date: '2026-10-17' })
    const out = layoutTimelineDisplay([a, b], 36)
    expect(out.get('a')).toEqual({ startMin: 540, endMin: 576 })
    expect(out.get('b')).toEqual({ startMin: 540, endMin: 576 })
  })

  it('空输入返回空表', () => {
    expect(layoutTimelineDisplay([], 36).size).toBe(0)
  })
})

describe('layoutTimeline — 时间轴映射（左边刻度要跟着拉高）', () => {  it('没有撑高/堆叠时，映射退化成恒等，整天仍是 1440 分钟', () => {
    const a = mkBlock('a', 540, 600)
    const b = mkBlock('b', 660, 720)
    const lay = layoutTimeline([a, b], 36)
    expect(lay.toDrawn(540)).toBe(540)
    expect(lay.toDrawn(1440)).toBe(1440)
    expect(lay.drawnTotal).toBe(1440)
    expect(lay.toReal(540)).toBe(540)
  })

  it('25 分钟计划块被撑高后，它之后的刻度整体下移', () => {
    const plan = mkBlock('p', 660, 685) // 11:00–11:25 → 撑到 36 分钟
    const lay = layoutTimeline([plan], 36)
    expect(lay.blocks.get('p')).toEqual({ startMin: 660, endMin: 696 })
    // 11:00 之前不受影响
    expect(lay.toDrawn(600)).toBe(600)
    // 11:00 之后顺延 11 分钟
    expect(lay.toDrawn(720)).toBe(720 + 11)
    expect(lay.drawnTotal).toBe(1440 + 11)
  })

  it('两个事件挤在同一时段时，这一段被撑高成两格', () => {
    const a = mkBlock('a', 540, 600)
    const b = mkBlock('b', 540, 600, { pending: true })
    const lay = layoutTimeline([a, b], 36)
    // 第二个被排到下方
    expect(lay.blocks.get('b')).toEqual({ startMin: 600, endMin: 660 })
    // 09:00 与 10:00 刻度之间因此变成 120 分钟的距离
    expect(lay.toDrawn(540)).toBe(540)
    expect(lay.toDrawn(600)).toBe(660)
    // 绘制回真实：屏幕上的 10:00 位置其实还是 09:00 那一段
    expect(lay.toReal(600)).toBe(540)
    expect(lay.toReal(660)).toBe(600)
  })

  it('toReal 与 toDrawn 在可用区间内互为逆运算', () => {
    const a = mkBlock('a', 540, 600)
    const b = mkBlock('b', 540, 600, { pending: true })
    const lay = layoutTimeline([a, b], 36)
    for (const m of [0, 300, 540, 555, 600, 800, 1200, 1440]) {
      expect(lay.toReal(lay.toDrawn(m))).toBe(m)
    }
  })
})

// ============================================================
//  重复规则增强
//  2026-10 的星期分布（与 i18n 无关，纯算术）：
//    10-01 周四(4)  10-05 周一(1)  10-30 周五(5)  10-31 周六(6)
// ============================================================

function repeatTask(patch: Parameters<typeof makeTask>[0]) {
  return makeTask({ title: '重复任务', ...patch })
}

describe('matchesRepeat — 每隔 n 个周期', () => {
  it('repeatEvery 缺省时行为与改造前一致（每天都命中）', () => {
    const task = repeatTask({ date: '2026-10-01', repeat: 'daily' })
    expect(matchesRepeat(task, '2026-10-02')).toBe(true)
    expect(matchesRepeat(task, '2026-10-05')).toBe(true)
  })

  it('daily + repeatEvery=3 → 每隔三天', () => {
    const task = repeatTask({ date: '2026-10-01', repeat: 'daily', repeatEvery: 3 })
    expect(matchesRepeat(task, '2026-10-01')).toBe(true)
    expect(matchesRepeat(task, '2026-10-02')).toBe(false)
    expect(matchesRepeat(task, '2026-10-04')).toBe(true)
    expect(matchesRepeat(task, '2026-10-07')).toBe(true)
  })

  it('weekly + repeatEvery=2 → 每两周的同一星期几', () => {
    const task = repeatTask({ date: '2026-10-05', repeat: 'weekly', repeatEvery: 2 })
    expect(matchesRepeat(task, '2026-10-05')).toBe(true)
    expect(matchesRepeat(task, '2026-10-12')).toBe(false)
    expect(matchesRepeat(task, '2026-10-19')).toBe(true)
  })

  it('monthly + repeatEvery=2 → 每两个月的同一号', () => {
    const task = repeatTask({ date: '2026-10-15', repeat: 'monthly', repeatEvery: 2 })
    expect(matchesRepeat(task, '2026-10-15')).toBe(true)
    expect(matchesRepeat(task, '2026-11-15')).toBe(false)
    expect(matchesRepeat(task, '2026-12-15')).toBe(true)
  })

  it('星期几不匹配时即使间隔也对不上', () => {
    const task = repeatTask({ date: '2026-10-05', repeat: 'weekly', repeatEvery: 2 })
    expect(matchesRepeat(task, '2026-10-21')).toBe(false) // 周三
  })
})

describe('matchesRepeat — 每月锚点方式', () => {
  it('nthWeekday：每月第一个周四', () => {
    const task = repeatTask({
      date: '2026-10-01',
      repeat: 'monthly',
      monthlyMode: 'nthWeekday',
      monthlyWeekOfMonth: 1,
      monthlyWeekday: 4
    })
    expect(matchesRepeat(task, '2026-10-01')).toBe(true) // 10-01 是本月第一个周四
    expect(matchesRepeat(task, '2026-10-08')).toBe(false) // 第二个周四
  })

  it('nthWeekday = -1：当月最后一个周五', () => {
    const task = repeatTask({
      date: '2026-10-01',
      repeat: 'monthly',
      monthlyMode: 'nthWeekday',
      monthlyWeekOfMonth: -1,
      monthlyWeekday: 5
    })
    expect(matchesRepeat(task, '2026-10-30')).toBe(true) // 当月最后一个周五
    expect(matchesRepeat(task, '2026-10-23')).toBe(false)
  })

  it('lastDay：每月最后一天（与起始日期的号数无关）', () => {
    const task = repeatTask({
      date: '2026-10-01',
      repeat: 'monthly',
      monthlyMode: 'lastDay'
    })
    expect(matchesRepeat(task, '2026-10-31')).toBe(true)
    expect(matchesRepeat(task, '2026-11-30')).toBe(true) // 小月只有 30 天
    expect(matchesRepeat(task, '2026-10-30')).toBe(false)
  })

  it('date 模式（默认）：每月同号', () => {
    const task = repeatTask({ date: '2026-10-15', repeat: 'monthly' })
    expect(matchesRepeat(task, '2026-10-15')).toBe(true)
    expect(matchesRepeat(task, '2026-11-15')).toBe(true)
    expect(matchesRepeat(task, '2026-11-16')).toBe(false)
  })

  it('nthWeekday 缺字段时退回不命中（而不是崩溃）', () => {
    const task = repeatTask({
      date: '2026-10-01',
      repeat: 'monthly',
      monthlyMode: 'nthWeekday'
    })
    expect(matchesRepeat(task, '2026-10-01')).toBe(false)
  })
})

describe('matchesRepeat — 单日例外与截止', () => {
  it('deletedInstanceDates 里的那一天不生成，其余照常', () => {
    const task = repeatTask({
      date: '2026-10-05',
      repeat: 'weekly',
      deletedInstanceDates: ['2026-10-12']
    })
    expect(matchesRepeat(task, '2026-10-05')).toBe(true)
    expect(matchesRepeat(task, '2026-10-12')).toBe(false) // 被单独删掉了
    expect(matchesRepeat(task, '2026-10-19')).toBe(true) // 整条系列仍然在
  })

  it('repeatUntil 之后不再生成', () => {
    const task = repeatTask({ date: '2026-10-01', repeat: 'daily', repeatUntil: '2026-10-05' })
    expect(matchesRepeat(task, '2026-10-05')).toBe(true)
    expect(matchesRepeat(task, '2026-10-06')).toBe(false)
  })
})

describe('expandRepeatingTasks — 过期实例与 skipOverdue', () => {
  it('不传 today 时不做任何过期过滤（保持向后兼容）', () => {
    const task = repeatTask({ date: '2026-10-01', repeat: 'daily' })
    const out = expandRepeatingTasks([task], '2026-10-01', '2026-10-05')
    expect(out).toHaveLength(5)
  })

  it('skipOverdue 时只展开今天及以后的实例', () => {
    const task = repeatTask({ date: '2026-10-01', repeat: 'daily', skipOverdue: true })
    const out = expandRepeatingTasks([task], '2026-10-01', '2026-10-05', '2026-10-03')
    // 10-03、10-04、10-05 → 3 条；10-01、10-02 被跳过
    expect(out.map((t) => t.date)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05'])
  })

  it('skipOverdue 关掉时整段都展开', () => {
    const task = repeatTask({ date: '2026-10-01', repeat: 'daily' })
    const out = expandRepeatingTasks([task], '2026-10-01', '2026-10-05', '2026-10-03')
    expect(out).toHaveLength(5)
  })

  it('实例 id 带日期，且 date 被覆盖成当天', () => {
    const task = repeatTask({ date: '2026-10-01', repeat: 'daily', repeatEvery: 2 })
    const out = expandRepeatingTasks([task], '2026-10-01', '2026-10-05')
    expect(out[0].id).toBe(`${task.id}@2026-10-01`)
    expect(out[0].date).toBe('2026-10-01')
  })

  it('非重复任务只在自己的日期出现一次', () => {
    const task = repeatTask({ date: '2026-10-03', repeat: 'none' })
    expect(expandRepeatingTasks([task], '2026-10-01', '2026-10-05')).toHaveLength(1)
  })
})

describe('nextFreeSlot — 给未指定时间的新任务挑空档', () => {
  it('没有占用时从当前时刻向上取整', () => {
    expect(nextFreeSlot([], 60, 9 * 60 + 7)).toEqual({ startMin: 9 * 60 + 15, endMin: 10 * 60 + 15 })
  })

  it('跳过已被占用的区间', () => {
    const occupied = [{ startMin: 9 * 60, endMin: 10 * 60 }]
    expect(nextFreeSlot(occupied, 60, 9 * 60)).toEqual({ startMin: 10 * 60, endMin: 11 * 60 })
  })

  it('首尾相接不算占用（半开区间）', () => {
    const occupied = [{ startMin: 9 * 60, endMin: 10 * 60 }]
    expect(nextFreeSlot(occupied, 30, 10 * 60)).toEqual({ startMin: 10 * 60, endMin: 10 * 60 + 30 })
  })

  it('全天排满时退回当日末尾，保证仍有一个落点', () => {
    const occupied = [{ startMin: 0, endMin: 24 * 60 }]
    expect(nextFreeSlot(occupied, 60, 8 * 60)).toEqual({ startMin: 23 * 60, endMin: 24 * 60 })
  })
})
