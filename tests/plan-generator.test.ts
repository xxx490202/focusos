// ============================================================
//  计划生成单测（F6）
// ============================================================
import { describe, it, expect } from 'vitest'
import { generatePlan, type Occupied } from '@main/scheduler/plan-generator'
import { makeTask, defaultSettings } from '@shared/defaults'
import type { Settings } from '@shared/types'

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...patch }
}

describe('计划生成 — 验收用例', () => {
  it('时间窗充足时产出恰好 5 个专注块 + 对应休息块', () => {
    const task = makeTask({
      id: 't1',
      title: '写方案',
      date: '2026-10-14',
      estimatedPomodoros: 5,
      priority: 2
    })
    const s = settings()
    // 09:00–12:00 全空（180 分钟），足够放 5×25 + 4×5 = 145 分钟
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '09:00', windowEnd: '12:00' },
      { tasks: [task], occupied: [], settings: s, todayFocusCount: 0 }
    )
    expect(result.blocks.filter((b) => b.phase === 'focus')).toHaveLength(5)
    // 4 个短休息（第 5 个专注后是长休息，但它排不进剩余空间）
    expect(result.blocks.filter((b) => b.phase === 'shortBreak').length).toBeGreaterThanOrEqual(3)
    // 全部落在时间窗内
    for (const b of result.blocks) {
      const start = Number(b.startTime.slice(0, 2)) * 60 + Number(b.startTime.slice(3))
      const end = Number(b.endTime.slice(0, 2)) * 60 + Number(b.endTime.slice(3))
      expect(start).toBeGreaterThanOrEqual(9 * 60)
      expect(end).toBeLessThanOrEqual(12 * 60)
    }
  })

  it('有会议占用时：全部落在窗口内且不与会议重叠（空隙不足则如实少排）', () => {
    const task = makeTask({
      id: 't1',
      title: '写方案',
      date: '2026-10-14',
      estimatedPomodoros: 5,
      priority: 2
    })
    const s = settings()
    // 09:00–12:00（180 分钟），两个 1 小时会议 → 仅剩 10:00–11:00 共 60 分钟空隙
    // ⭐ 注意：5 个番茄需 125 分钟专注 + 休息，物理上放不下，
    //    因此此处断言「不重叠 + 都在窗口内」，数量按实际空隙给出。
    const occupied: Occupied = [
      { date: '2026-10-14', startMin: 9 * 60, endMin: 10 * 60 },
      { date: '2026-10-14', startMin: 11 * 60, endMin: 12 * 60 }
    ]

    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '09:00', windowEnd: '12:00' },
      { tasks: [task], occupied, settings: s, todayFocusCount: 0 }
    )

    const focusBlocks = result.blocks.filter((b) => b.phase === 'focus')
    // 60 分钟空隙 = 1 个专注(25) + 休息(5) + 1 个专注(25)，放得下 2 个
    expect(focusBlocks.length).toBeGreaterThanOrEqual(1)
    expect(focusBlocks.length).toBeLessThanOrEqual(2)

    for (const b of result.blocks) {
      const start = Number(b.startTime.slice(0, 2)) * 60 + Number(b.startTime.slice(3))
      const end = Number(b.endTime.slice(0, 2)) * 60 + Number(b.endTime.slice(3))
      // 全部落在时间窗内
      expect(start).toBeGreaterThanOrEqual(9 * 60)
      expect(end).toBeLessThanOrEqual(12 * 60)
      // 不与会议重叠
      for (const o of occupied) {
        expect(start < o.endMin && o.startMin < end).toBe(false)
      }
    }
  })

  it('专注块之间互不重叠', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 4 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '09:00', windowEnd: '12:00' },
      { tasks: [task], occupied: [], settings: settings(), todayFocusCount: 0 }
    )
    const intervals = result.blocks
      .map((b) => ({
        s: Number(b.startTime.slice(0, 2)) * 60 + Number(b.startTime.slice(3)),
        e: Number(b.endTime.slice(0, 2)) * 60 + Number(b.endTime.slice(3))
      }))
      .sort((a, b) => a.s - b.s)
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i].s).toBeGreaterThanOrEqual(intervals[i - 1].e)
    }
  })

  it('每 4 个专注后插长休息', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 4 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '08:00', windowEnd: '20:00' },
      { tasks: [task], occupied: [], settings: settings(), todayFocusCount: 0 }
    )
    expect(result.blocks.filter((b) => b.phase === 'longBreak')).toHaveLength(1)
    expect(result.blocks.filter((b) => b.phase === 'shortBreak')).toHaveLength(3)
    expect(result.blocks.filter((b) => b.phase === 'focus')).toHaveLength(4)
  })

  it('专注块长度 = settings.workMinutes', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 1 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '09:00', windowEnd: '12:00' },
      {
        tasks: [task],
        occupied: [],
        settings: settings({ durations: { workMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20 } }),
        todayFocusCount: 0
      }
    )
    const f = result.blocks.find((b) => b.phase === 'focus')!
    const start = Number(f.startTime.slice(0, 2)) * 60 + Number(f.startTime.slice(3))
    const end = Number(f.endTime.slice(0, 2)) * 60 + Number(f.endTime.slice(3))
    expect(end - start).toBe(50)
  })

  it('遵守每日番茄上限', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 10 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '00:00', windowEnd: '23:59' },
      { tasks: [task], occupied: [], settings: settings({ dailyPomodoroLimit: 3 }), todayFocusCount: 0 }
    )
    expect(result.blocks.filter((b) => b.phase === 'focus')).toHaveLength(3)
    expect(result.skipped.some((s) => s.reason.includes('上限'))).toBe(true)
  })

  it('todayFocusCount 计入上限', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 5 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '00:00', windowEnd: '23:59' },
      { tasks: [task], occupied: [], settings: settings({ dailyPomodoroLimit: 12 }), todayFocusCount: 10 }
    )
    expect(result.blocks.filter((b) => b.phase === 'focus')).toHaveLength(2)
  })

  it('跳过勿扰时段内的块', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 6 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '20:00', windowEnd: '23:30' },
      {
        tasks: [task],
        occupied: [],
        // 22:00–23:30 全程勿扰
        settings: settings({ dndEnabled: true, dnd: { from: '22:00', to: '23:30' } }),
        todayFocusCount: 0
      }
    )
    // ⭐ 任何块都不得与 [22:00, 23:30) 相交
    const dndStart = 22 * 60
    const dndEnd = 23 * 60 + 30
    for (const b of result.blocks) {
      const start = Number(b.startTime.slice(0, 2)) * 60 + Number(b.startTime.slice(3))
      const end = Number(b.endTime.slice(0, 2)) * 60 + Number(b.endTime.slice(3))
      const overlaps = start < dndEnd && dndStart < end
      expect(overlaps).toBe(false)
    }
    // 勿扰前的空档确实被利用了（20:00 起至少排出 1 个专注）
    expect(result.blocks.filter((b) => b.phase === 'focus').length).toBeGreaterThanOrEqual(1)
  })

  it('跨零点的勿扰时段（如 22:00–08:00）也能正确跳过', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 4 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '21:00', windowEnd: '23:30' },
      {
        tasks: [task],
        occupied: [],
        settings: settings({ dndEnabled: true, dnd: { from: '22:00', to: '08:00' } }),
        todayFocusCount: 0
      }
    )
    for (const b of result.blocks) {
      const end = Number(b.endTime.slice(0, 2)) * 60 + Number(b.endTime.slice(3))
      // 22:00 之后一律不排
      expect(end).toBeLessThanOrEqual(22 * 60)
    }
  })

  it('多任务按 priority 降序排入', () => {
    const low = makeTask({ id: 'low', title: '低', date: '2026-10-14', estimatedPomodoros: 1, priority: 0 })
    const high = makeTask({ id: 'high', title: '高', date: '2026-10-14', estimatedPomodoros: 1, priority: 2 })
    const mid = makeTask({ id: 'mid', title: '中', date: '2026-10-14', estimatedPomodoros: 1, priority: 1 })
    const result = generatePlan(
      { taskIds: ['low', 'high', 'mid'], date: '2026-10-14', windowStart: '09:00', windowEnd: '12:00' },
      { tasks: [low, high, mid], occupied: [], settings: settings(), todayFocusCount: 0 }
    )
    const order = result.blocks.filter((b) => b.phase === 'focus').map((b) => b.taskId)
    expect(order).toEqual(['high', 'mid', 'low'])
  })

  it('时间窗放不下时如实报告跳过原因', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 5 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '09:00', windowEnd: '09:30' },
      { tasks: [task], occupied: [], settings: settings(), todayFocusCount: 0 }
    )
    // 30 分钟窗口放不下 25 分钟专注 + 休息，最多 1 个专注
    expect(result.blocks.filter((b) => b.phase === 'focus').length).toBeLessThanOrEqual(1)
    expect(result.skipped.length).toBeGreaterThan(0)
  })

  it('窗口结束早于开始时自动交换', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 1 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '12:00', windowEnd: '09:00' },
      { tasks: [task], occupied: [], settings: settings(), todayFocusCount: 0 }
    )
    expect(result.blocks.filter((b) => b.phase === 'focus')).toHaveLength(1)
  })

  it('estimatedPomodoros=0 的任务不产出块', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 0 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '09:00', windowEnd: '12:00' },
      { tasks: [task], occupied: [], settings: settings(), todayFocusCount: 0 }
    )
    expect(result.blocks).toHaveLength(0)
  })

  it('产出按时间升序排列（预览态可读）', () => {
    const task = makeTask({ id: 't1', title: 'x', date: '2026-10-14', estimatedPomodoros: 4 })
    const result = generatePlan(
      { taskIds: ['t1'], date: '2026-10-14', windowStart: '09:00', windowEnd: '14:00' },
      { tasks: [task], occupied: [], settings: settings(), todayFocusCount: 0 }
    )
    const starts = result.blocks.map((b) => Number(b.startTime.slice(0, 2)) * 60 + Number(b.startTime.slice(3)))
    const sorted = [...starts].sort((a, b) => a - b)
    expect(starts).toEqual(sorted)
  })
})
