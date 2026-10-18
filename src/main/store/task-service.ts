// ============================================================
//  task-service.ts — 任务 / 计划块 / 会话 / 统计 业务
// ============================================================
import { repository } from './repository'
import { scopedLogger } from './logger'
import { makeTask, makePlanBlock, makeSession, makeDailyStat, makeHabit } from '@shared/defaults'
import type {
  Task,
  PlanBlock,
  Session,
  DailyStat,
  Settings,
  PersistedData,
  TaskStatus,
  ChecklistItem,
  Habit
} from '@shared/types'
import { makeId } from '@shared/defaults'
import { dateKey, expandRepeatingTasks, type TimeBlock, blockOfTask } from '@shared/schedule'

const log = scopedLogger('task')

function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function save(data: PersistedData): void {
  repository.write(data)
}

// ============================================================
//  任务
// ============================================================

export function listTasks(): Task[] {
  return repository.read().tasks
}

export function createTask(draft: Partial<Task>): Task {
  const data = repository.read()
  const task = makeTask({ ...draft, id: draft.id ?? makeId('task') })
  data.tasks.push(task)
  save(data)
  log.info(`新建任务 ${task.id}`)
  return task
}

export function updateTask(id: string, patch: Partial<Task>): Task {
  const data = repository.read()
  const idx = data.tasks.findIndex((t) => t.id === id)
  if (idx === -1) throw new Error('任务不存在')
  /*
   * ⚠️ pending 是「可选布尔」，undefined 不能被当成一次赋值。
   *    zod 的 .partial() 会把入参里显式出现的 pending: undefined 原样带出来，
   *    若直接展开，就会把待确认的任务**静默变成已确认**（等于用户没点就自动排期了）。
   *    确认动作显式传 false，因此这里删掉 undefined 是安全的。
   */
  const clean: Partial<Task> = { ...patch }
  if (clean.pending === undefined) delete clean.pending
  const next = { ...data.tasks[idx], ...clean, id, updatedAt: Date.now() }
  data.tasks[idx] = next
  save(data)
  return next
}

/**
 * 删除任务，并返回一份可用于「撤销」的完整快照。
 *
 * ⚠️ 计划块必须一起进快照：删除时它们被级联清掉了，
 *    只恢复任务会让番茄计划凭空消失（用户会以为数据没恢复干净）。
 */
export function deleteTask(id: string): { task: Task; planBlocks: PlanBlock[] } {
  const data = repository.read()
  const task = data.tasks.find((t) => t.id === id)
  if (!task) throw new Error('任务不存在')
  const planBlocks = data.planBlocks.filter((p) => p.taskId === id)

  data.tasks = data.tasks.filter((t) => t.id !== id)
  data.planBlocks = data.planBlocks.filter((p) => p.taskId !== id)
  save(data)
  return { task, planBlocks }
}

/**
 * 撤销删除：把快照原样写回。
 * 已存在同 id 的任务时返回 false（避免重复写入造成两份）。
 */
export function restoreTask(snapshot: { task: Task; planBlocks: PlanBlock[] }): boolean {
  const data = repository.read()
  if (data.tasks.some((t) => t.id === snapshot.task.id)) return false
  data.tasks.push(snapshot.task)
  for (const p of snapshot.planBlocks) {
    if (!data.planBlocks.some((x) => x.id === p.id)) data.planBlocks.push(p)
  }
  save(data)
  log.info(`撤销删除：恢复任务 ${snapshot.task.id}`)
  return true
}

/**
 * 删除重复日程里的**某一次**。
 *
 * ⭐ 没有这个入口时，用户右键删掉重复日程里的某一天，
 *    走的是 deleteTask —— 会把整条系列删掉。
 *    这里改成只把该日期记进 deletedInstanceDates，系列本身不动。
 * 返回更新后的任务；非重复任务则抛错，由上层提示。
 */
export function skipRepeatInstance(taskId: string, date: string): Task {
  const data = repository.read()
  const idx = data.tasks.findIndex((t) => t.id === taskId)
  if (idx === -1) throw new Error('任务不存在')
  const task = data.tasks[idx]
  if (task.repeat === 'none') throw new Error('这不是重复任务')

  const list = [...(task.deletedInstanceDates ?? [])]
  if (!list.includes(date)) list.push(date)
  const next: Task = { ...task, deletedInstanceDates: list, updatedAt: Date.now() }
  data.tasks[idx] = next
  save(data)
  log.info(`跳过重复实例 ${taskId} @ ${date}`)
  return next
}

/**
 * 「结束今天」：把 from 那天**未完成**的任务整体顺延到 to。
 *
 * · 已完成 / 已归档不动；未排期（date=null）本来就不在这天，不动
 * · 时段原样保留 —— 用户第二天大多还是同一时间做，改时间比重填划算
 * · 返回顺延的条数，供提示文案使用
 */
export function rolloverUnfinished(from: string, to: string): number {
  if (from === to) return 0
  const data = repository.read()
  let moved = 0
  for (const t of data.tasks) {
    if (t.date !== from) continue
    if (t.status === 'done' || t.status === 'archived') continue
    t.date = to
    t.updatedAt = Date.now()
    moved += 1
  }
  if (moved > 0) save(data)
  log.info(`结束今天：${moved} 条任务顺延 ${from} → ${to}`)
  return moved
}

// ============================================================
//  习惯计数器
// ============================================================

export function listHabits(): Habit[] {
  return repository.read().habits
}

export function createHabit(draft: Partial<Habit>): Habit {
  const data = repository.read()
  const habit = makeHabit({ ...draft, id: draft.id ?? makeId('habit') })
  data.habits.push(habit)
  save(data)
  return habit
}

export function updateHabit(id: string, patch: Partial<Habit>): Habit {
  const data = repository.read()
  const idx = data.habits.findIndex((h) => h.id === id)
  if (idx === -1) throw new Error('习惯不存在')
  const next: Habit = { ...data.habits[idx], ...patch, id, updatedAt: Date.now() }
  data.habits[idx] = next
  save(data)
  return next
}

export function deleteHabit(id: string): void {
  const data = repository.read()
  data.habits = data.habits.filter((h) => h.id !== id)
  save(data)
}

/**
 * 写入某一天的值（新值，不是增量）。
 * ⚠️ value 为 0 时把这一天的键**删掉**而不是写 0 ——
 *    否则数据文件会随使用天数无限膨胀（每天每条习惯都留一个 0）。
 */
export function setHabitValue(id: string, date: string, value: number): Habit {
  const data = repository.read()
  const idx = data.habits.findIndex((h) => h.id === id)
  if (idx === -1) throw new Error('习惯不存在')
  const habit = data.habits[idx]
  const entries = { ...habit.entries }
  if (value <= 0) delete entries[date]
  else entries[date] = value
  const next: Habit = { ...habit, entries, updatedAt: Date.now() }
  data.habits[idx] = next
  save(data)
  return next
}

// ============================================================
//  任务的增删改查
// ============================================================

export function duplicateTask(id: string): Task {
  const data = repository.read()
  const src = data.tasks.find((t) => t.id === id)
  if (!src) throw new Error('任务不存在')
  const copy = makeTask({
    ...src,
    id: makeId('task'),
    title: `${src.title} 副本`,
    status: 'todo',
    completedPomodoros: 0,
    completedAt: undefined,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  data.tasks.push(copy)
  save(data)
  return copy
}

export function setTaskStatus(id: string, status: TaskStatus): Task {
  const patch: Partial<Task> = { status }
  if (status === 'done') patch.completedAt = Date.now()
  if (status === 'todo') patch.completedAt = undefined
  return updateTask(id, patch)
}

/** 标记完成并给当天 tasksDone +1（番茄达标自动完成时也走这里） */
export function completeTask(id: string): Task {
  const task = updateTask(id, { status: 'done', completedAt: Date.now() })
  recordTaskDone(dateKey(task.completedAt ?? Date.now()))
  return task
}

export function recordTaskDone(date: string): void {
  const data = repository.read()
  bumpDaily(data, date, (s) => {
    s.tasksDone += 1
  })
  save(data)
}

// ============================================================
//  计划块
// ============================================================

export function listPlanBlocks(): PlanBlock[] {
  return repository.read().planBlocks
}

export function commitPlanBlocks(
  blocks: { taskId: string; date: string; startTime: string; endTime: string; phase: PlanBlock['phase']; index: number }[]
): PlanBlock[] {
  const data = repository.read()
  const created = blocks.map((b) => makePlanBlock(b))
  data.planBlocks.push(...created)
  save(data)
  log.info(`写入 ${created.length} 个计划块`)
  return created
}

export function clearPlanBlocks(date: string, taskIds?: string[]): void {
  const data = repository.read()
  data.planBlocks = data.planBlocks.filter((p) => {
    if (p.date !== date) return true
    if (taskIds && !taskIds.includes(p.taskId)) return true
    return false
  })
  save(data)
}

/**
 * 删除**单个**计划块（时间轴上右键 → 删除）。
 *
 * ⚠️ 与 clearPlanBlocks 的区别：后者按「日期 + 任务」批量清，
 *    同一个任务在同一天可能排了好几个番茄块，用批量的会把整串都删掉。
 *    用户右键的是眼前这一块，因此必须有按 id 精确删除的入口。
 * 返回是否真的删掉了（id 不存在时为 false，便于上层提示）。
 */
export function removePlanBlock(id: string): boolean {
  const data = repository.read()
  const before = data.planBlocks.length
  data.planBlocks = data.planBlocks.filter((p) => p.id !== id)
  if (data.planBlocks.length === before) return false
  save(data)
  log.info(`删除计划块 ${id}`)
  return true
}

// ============================================================
//  会话与统计
// ============================================================

export function listSessions(fromTs?: number): Session[] {
  const all = repository.read().sessions
  return fromTs === undefined ? all : all.filter((s) => s.endedAt >= fromTs)
}

export function recordSession(info: {
  taskId?: string
  phase: Session['phase']
  plannedSeconds: number
  actualSeconds: number
  startedAt: number
  endedAt: number
  completed: boolean
  skipped?: boolean
}): Session {
  const data = repository.read()
  const session = makeSession({ ...info })
  data.sessions.push(session)

  // ⭐ 只有「专注 + 自然走完」才计入完成番茄数
  if (info.phase === 'focus' && info.completed) {
    const date = dateKey(info.endedAt)
    bumpDaily(data, date, (s) => {
      s.focusCount += 1
      s.focusSeconds += info.actualSeconds
    })
    // 绑定任务的完成番茄数 +1
    if (info.taskId) {
      const t = data.tasks.find((x) => x.id === info.taskId)
      if (t) {
        t.completedPomodoros += 1
        t.updatedAt = info.endedAt
        // 达标自动置为已完成
        if (t.estimatedPomodoros > 0 && t.completedPomodoros >= t.estimatedPomodoros) {
          if (t.status !== 'done') {
            t.status = 'done'
            t.completedAt = info.endedAt
            bumpDaily(data, date, (s) => {
              s.tasksDone += 1
            })
          }
        } else if (t.status === 'todo') {
          t.status = 'doing'
        }
      }
    }
  }

  save(data)
  return session
}

function bumpDaily(data: PersistedData, date: string, fn: (s: DailyStat) => void): void {
  let stat = data.dailyStats.find((s) => s.date === date)
  if (!stat) {
    stat = makeDailyStat(date)
    data.dailyStats.push(stat)
  }
  fn(stat)
}

export function listDailyStats(): DailyStat[] {
  return repository.read().dailyStats
}

/** 今日已完成专注数（F2 基础显示） */
export function todayFocusCount(): number {
  const stat = repository.read().dailyStats.find((s) => s.date === todayKey())
  return stat?.focusCount ?? 0
}

// ============================================================
//  供渲染层用的时间轴数据（循环任务已展开）
// ============================================================

export function blocksForRange(from: string, to: string, settings: Settings): TimeBlock[] {
  const data = repository.read()
  const expanded = expandRepeatingTasks(data.tasks, from, to, todayKey())
  const out: TimeBlock[] = []
  for (const task of expanded) {
    const b = blockOfTask(task, settings.defaultTaskMinutes)
    if (b) out.push(b)
  }
  // 计划块并入同一时间轴
  for (const p of data.planBlocks) {
    if (p.date < from || p.date > to) continue
    const task = data.tasks.find((t) => t.id === p.taskId)
    const startMin = hm(p.startTime)
    const endMin = hm(p.endTime)
    if (startMin === null) continue
    out.push({
      id: p.id,
      taskId: p.taskId,
      title: task?.title ?? '专注',
      date: p.date,
      startMin,
      endMin: endMin !== null && endMin > startMin ? endMin : startMin + (p.phase === 'focus' ? settings.durations.workMinutes : 5),
      category: task?.category ?? 'work',
      priority: task?.priority ?? 1,
      status: task?.status ?? 'todo',
      kind: 'plan',
      phase: p.phase,
      repeat: 'none'
    })
  }
  return out
}

function hm(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export { todayKey }
export type { ChecklistItem }
