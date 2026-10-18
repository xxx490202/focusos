// ============================================================
//  habits.ts — 习惯计数器的纯逻辑（无 IO、无 Date.now）
// ============================================================
//  和 schedule.ts 一样保持「可完整单测」：所有需要「今天」的地方都由调用方传入。
// ============================================================
import type { Habit } from './types'

/** 某一天的实际值（没记录就是 0） */
export function habitValueOn(habit: Habit, date: string): number {
  return habit.entries[date] ?? 0
}

/**
 * 某一天算不算「已打卡」。
 * · streakNeedsTarget = true → 必须达到 dailyTarget
 * · false                    → 只要 > 0 就算
 */
export function isHabitDoneOn(habit: Habit, date: string): boolean {
  const need = habit.streakNeedsTarget ? habit.dailyTarget : 1
  return habitValueOn(habit, date) >= need
}

/** 今天还差多少达标（已达标返回 0） */
export function habitRemainingToday(habit: Habit, date: string, today: string): number {
  if (date !== today) return 0
  return Math.max(0, habit.dailyTarget - habitValueOn(habit, date))
}

/**
 * 连续打卡天数。
 *
 * ⚠️ 两个刻意的判定：
 *    1. **今天还没打卡不算断**。否则用户每天早上打开看到的连续天数都是 0，
 *       会觉得「我的连续记录又没了」—— 这是最容易把 streak 做废的地方。
 *       所以从今天往回数之前，先看今天达标没有，没达标就从昨天起算。
 *    2. 一旦遇到没达标的日子就立刻停，不做任何「补卡」。
 */
export function habitStreak(habit: Habit, today: string): number {
  let cursor = today
  if (!isHabitDoneOn(habit, cursor)) cursor = shiftDay(cursor, -1)

  let streak = 0
  // 防御性上限：10 年，避免脏数据里的日期造成死循环
  for (let i = 0; i < 3660; i++) {
    if (!isHabitDoneOn(habit, cursor)) break
    streak += 1
    cursor = shiftDay(cursor, -1)
  }
  return streak
}

/** 'YYYY-MM-DD' 偏移若干天。与 schedule.addDays 同语义，这里内联避免循环依赖 */
function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  t.setUTCDate(t.getUTCDate() + days)
  const yy = t.getUTCFullYear()
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(t.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** 最近 n 天（含今天）的达标情况，从早到晚。给热力条用 */
export function habitRecentDays(habit: Habit, today: string, n = 14): boolean[] {
  const out: boolean[] = []
  for (let i = n - 1; i >= 0; i--) out.push(isHabitDoneOn(habit, shiftDay(today, -i)))
  return out
}

/** 秒表型习惯的展示格式：>=1 分钟显示「X 分」，否则「X 秒」 */
export function formatHabitValue(habit: Habit, value: number): string {
  if (habit.type !== 'stopwatch') return String(value)
  if (value < 60) return `${value} 秒`
  const m = Math.floor(value / 60)
  const s = value % 60
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`
}
