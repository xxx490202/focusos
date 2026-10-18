// ============================================================
//  habits.test.ts — 习惯计数器的纯逻辑
// ============================================================
import { describe, it, expect } from 'vitest'
import {
  habitValueOn,
  isHabitDoneOn,
  habitStreak,
  habitRecentDays,
  formatHabitValue
} from '@shared/habits'
import { makeHabit } from '@shared/defaults'

const TODAY = '2026-10-16'

function habit(entries: Record<string, number>, patch: Parameters<typeof makeHabit>[0] = {}) {
  return makeHabit({ title: '喝水', dailyTarget: 8, entries, ...patch })
}

describe('习惯 — 取值与达标', () => {
  it('没记录的日期取 0', () => {
    expect(habitValueOn(habit({}), TODAY)).toBe(0)
  })

  it('默认必须达到目标才算打卡', () => {
    const h = habit({ [TODAY]: 7 })
    expect(isHabitDoneOn(h, TODAY)).toBe(false)
    expect(isHabitDoneOn(habit({ [TODAY]: 8 }), TODAY)).toBe(true)
  })

  it('关掉「按目标判定」后只要 >0 就算', () => {
    const h = habit({ [TODAY]: 1 }, { streakNeedsTarget: false })
    expect(isHabitDoneOn(h, TODAY)).toBe(true)
    expect(isHabitDoneOn(habit({}, { streakNeedsTarget: false }), TODAY)).toBe(false)
  })
})

describe('习惯 — 连续打卡天数', () => {
  it('连续三天达标 → streak = 3', () => {
    const h = habit({ '2026-10-14': 8, '2026-10-15': 8, '2026-10-16': 8 })
    expect(habitStreak(h, TODAY)).toBe(3)
  })

  /*
   * ⭐ 这是最容易把 streak 做废的地方：
   *    如果「今天还没打卡」就直接返回 0，
   *    用户每天早上打开看到的连续记录都是断的。
   */
  it('今天还没打卡不算断，从昨天起算', () => {
    const h = habit({ '2026-10-14': 8, '2026-10-15': 8 })
    expect(habitStreak(h, TODAY)).toBe(2)
  })

  it('中间断了一天就停', () => {
    const h = habit({ '2026-10-12': 8, '2026-10-13': 8, '2026-10-15': 8, '2026-10-16': 8 })
    expect(habitStreak(h, TODAY)).toBe(2)
  })

  it('今天和昨天都没打卡 → 0', () => {
    expect(habitStreak(habit({ '2026-10-10': 8 }), TODAY)).toBe(0)
  })

  it('没达标的一天同样会中断连续', () => {
    const h = habit({ '2026-10-15': 8, '2026-10-16': 7 })
    // 今天只有 7 次、没达标 → 从昨天起算
    expect(habitStreak(h, TODAY)).toBe(1)
  })

  it('跨月连续也能正确计算', () => {
    const h = habit({
      '2026-09-30': 8,
      '2026-10-01': 8,
      '2026-10-02': 8
    })
    expect(habitStreak(h, '2026-10-02')).toBe(3)
  })
})

describe('习惯 — 最近 N 天与格式化', () => {
  it('最近 3 天返回从早到晚的达标数组', () => {
    const h = habit({ '2026-10-15': 8, '2026-10-16': 8 })
    expect(habitRecentDays(h, TODAY, 3)).toEqual([false, true, true])
  })

  it('点击型直接显示次数', () => {
    expect(formatHabitValue(habit({}), 8)).toBe('8')
  })

  it('计时型按秒/分显示', () => {
    const h = habit({}, { type: 'stopwatch', dailyTarget: 600 })
    expect(formatHabitValue(h, 45)).toBe('45 秒')
    expect(formatHabitValue(h, 600)).toBe('10 分')
    expect(formatHabitValue(h, 630)).toBe('10 分 30 秒')
  })
})
