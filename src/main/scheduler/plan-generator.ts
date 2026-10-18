// ============================================================
//  plan-generator.ts — 自动番茄计划生成（F6核心差异化）
// ============================================================
//  把「任务」翻译成「可执行的时间块」。
//  本模块为纯函数（无 IO、无 Date.now），因此可完整单测。
// ============================================================
import type {
  Task,
  Settings,
  TimerPhase,
  PlanPreviewBlock,
  PlanRequest
} from '@shared/types'
import {
  timeToMinutes,
  minutesToTime,
  rangeIntersectsDnd,
  blocksOverlap
} from '@shared/schedule'

export interface OccupiedSlot {
  date: string
  startMin: number
  endMin: number
}

/** 已被占用的时间：其他任务块 + 已生成的计划块 */
export type Occupied = OccupiedSlot[]

export interface GenerateOptions {
  tasks: Task[]
  /** 已占用的时间片 */
  occupied: Occupied
  settings: Settings
  /** 当日已完成的专注数（用于每日番茄上限） */
  todayFocusCount: number
}

export interface GenerateResult {
  blocks: PlanPreviewBlock[]
  skipped: { reason: string; count: number }[]
}

const SKIP_REASONS = {
  dailyLimit: '已达每日番茄上限',
  dnd: '落在勿扰时段',
  noRoom: '时间窗内剩余空间不足'
} as const

/**
 * 生成番茄计划。
 *
 * 算法（对应规范 F6）：
 *  1. 按各任务 estimatedPomodoros 展开为专注块，长度 = settings.workMinutes，
 *     每块后插休息（每 longBreakEvery 个专注后插长休息）
 *  2. 在时间窗内跳过已被占用的时间（其他任务块 + 已生成的计划块）
 *  3. 遵守每日番茄上限与勿扰时段
 *  4. 多任务按 priority 降序 + date 升序依次排入
 *
 * 产出是「预览态」，由渲染层确认后才写入 PlanBlock。
 */
export function generatePlan(request: PlanRequest, opts: GenerateOptions): GenerateResult {
  const { date, windowStart, windowEnd } = request
  const { settings, occupied } = opts
  const longBreakEvery = request.longBreakEvery ?? settings.longBreakEvery

  const winStart = timeToMinutes(windowStart)
  const winEnd = timeToMinutes(windowEnd)
  if (winStart === null || winEnd === null) {
    return { blocks: [], skipped: [] }
  }
  // 防御：窗口结束早于开始则交换
  const lo = Math.min(winStart, winEnd)
  const hi = Math.max(winStart, winEnd)

  // 4. 排序：priority 降序 → date 升序（null 视为最远）
  const targets = opts.tasks
    .filter((t) => t.estimatedPomodoros > 0)
    .slice()
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      const da = a.date ?? '9999-12-31'
      const db = b.date ?? '9999-12-31'
      return da < db ? -1 : da > db ? 1 : 0
    })

  const workMin = settings.durations.workMinutes
  const shortMin = settings.durations.shortBreakMinutes
  const longMin = settings.durations.longBreakMinutes

  const blocks: PlanPreviewBlock[] = []
  const skipped: { reason: string; count: number }[] = []
  let skipDaily = 0
  let skipDnd = 0
  let skipRoom = 0

  // 工作副本：边生成边追加，避免互相重叠
  const taken: Occupied = occupied.filter((s) => s.date === date).map((s) => ({ ...s }))

  let focusIndex = 0 // 本次生成内的专注序号，用于判断长休息
  let producedFocus = 0

  /**
   * 跳过勿扰时段的辅助逻辑。
   * 做法：把该空位标记为已占用，让后续 findSlot 自动绕开，
   * 而不是重试同一个番茄（否则会死循环）。
   */
  const blockedByDnd = new Set<number>()

  for (const task of targets) {
    for (let i = 0; i < task.estimatedPomodoros; i++) {
      // 3a. 每日番茄上限 —— 达到上限后直接结束整个生成
      if (opts.todayFocusCount + producedFocus >= settings.dailyPomodoroLimit) {
        skipDaily += task.estimatedPomodoros - i
        break
      }

      // 1. 找一个放得下专注块的空位
      const focusSlot = findSlot(taken, lo, hi, workMin, blockedByDnd)

      // 时间窗内再也放不下 → 剩余番茄全部记为空间不足
      if (focusSlot === null) {
        skipRoom += task.estimatedPomodoros - i
        break
      }

      // 3b. 勿扰时段：整段落在勿扰内则跳过该空位，换下一个位置
      if (
        settings.dndEnabled &&
        rangeIntersectsDnd(focusSlot, focusSlot + workMin, settings.dnd.from, settings.dnd.to)
      ) {
        skipDnd++
        blockedByDnd.add(focusSlot)
        // 不消耗一个番茄名额，继续为当前这一个找位置
        i--
        // 安全阀：所有候选空位都被判定为勿扰时退出
        if (allCandidatesBlocked(taken, lo, hi, workMin, blockedByDnd)) break
        continue
      }

      blocks.push({
        taskId: task.id,
        taskTitle: task.title,
        date,
        startTime: minutesToTime(focusSlot),
        endTime: minutesToTime(focusSlot + workMin),
        phase: 'focus',
        index: focusIndex
      })
      taken.push({ date, startMin: focusSlot, endMin: focusSlot + workMin })
      producedFocus++

      // 1b. 每块后插休息：每 longBreakEvery 个专注后插长休息
      focusIndex++
      const needLong = focusIndex > 0 && focusIndex % longBreakEvery === 0
      const restMin = needLong ? longMin : shortMin
      const restSlot = findSlot(taken, lo, hi, restMin)
      if (restSlot !== null) {
        const dndHit =
          settings.dndEnabled &&
          rangeIntersectsDnd(restSlot, restSlot + restMin, settings.dnd.from, settings.dnd.to)
        if (!dndHit) {
          blocks.push({
            taskId: task.id,
            taskTitle: task.title,
            date,
            startTime: minutesToTime(restSlot),
            endTime: minutesToTime(restSlot + restMin),
            phase: needLong ? 'longBreak' : 'shortBreak',
            index: focusIndex
          })
          taken.push({ date, startMin: restSlot, endMin: restSlot + restMin })
        } else {
          skipDnd++
        }
      }
    }
  }

  // 按时间排序，预览态更好读
  blocks.sort((a, b) => timeToMinutes(a.startTime)! - timeToMinutes(b.startTime)!)

  if (skipDaily > 0) skipped.push({ reason: SKIP_REASONS.dailyLimit, count: skipDaily })
  if (skipDnd > 0) skipped.push({ reason: SKIP_REASONS.dnd, count: skipDnd })
  if (skipRoom > 0) skipped.push({ reason: SKIP_REASONS.noRoom, count: skipRoom })

  return { blocks, skipped }
}

/** 收集所有候选起点 */
function candidateSlots(taken: Occupied, lo: number, hi: number, duration: number): number[] {
  const candidates = new Set<number>([lo])
  for (const slot of taken) {
    candidates.add(slot.endMin)
    candidates.add(slot.startMin - duration)
  }
  return [...candidates]
    .filter((m) => m >= lo && m + duration <= hi)
    .sort((a, b) => a - b)
}

/**
 * 在 [lo, hi] 内找一个不与 taken 冲突、且能容纳 duration 分钟的起始分钟。
 * 找不到返回 null。
 */
function findSlot(
  taken: Occupied,
  lo: number,
  hi: number,
  duration: number,
  blocked?: Set<number>
): number | null {
  if (lo + duration > hi) return null
  for (const start of candidateSlots(taken, lo, hi, duration)) {
    if (blocked?.has(start)) continue
    const end = start + duration
    const conflict = taken.some((s) => blocksOverlap({ startMin: start, endMin: end }, s))
    if (!conflict) return start
  }
  return null
}

/** 所有候选空位都已被勿扰标记 → 无处可放，安全退出避免死循环 */
function allCandidatesBlocked(
  taken: Occupied,
  lo: number,
  hi: number,
  duration: number,
  blocked: Set<number>
): boolean {
  const all = candidateSlots(taken, lo, hi, duration)
  if (all.length === 0) return true
  return all.every((m) => blocked.has(m))
}

export { SKIP_REASONS }
export type { TimerPhase }
