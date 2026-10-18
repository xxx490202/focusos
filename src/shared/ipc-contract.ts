// ============================================================
//  ipc-contract.ts — 通道名常量 + payload 类型（前后端唯一真源）
// ============================================================
//  所有 ipcMain.handle 入参都必须过zod 校验；
//  渲染层消费的数据同样按本文件的类型声明。
// ============================================================
import { z } from 'zod'
import type {
  Task,
  Session,
  DailyStat,
  PlanBlock,
  Settings,
  TimerState,
  EffectiveTheme,
  ThemeMode,
  PlanPreviewBlock,
  Habit
} from './types'

// ============================================================
//  通道名
// ============================================================
export const IPC = {
  // ---- 启动引导 ----
  bootstrap: 'app:bootstrap',

  // ---- 任务 ----
  taskList: 'task:list',
  taskCreate: 'task:create',
  taskUpdate: 'task:update',
  taskDelete: 'task:delete',
  taskDuplicate: 'task:duplicate',
  taskArchive: 'task:archive',
  taskComplete: 'task:complete',
  /** 撤销删除：把删除时留下的完整快照原样写回 */
  taskRestore: 'task:restore',
  /** 只删掉重复日程里的某一次（记进单日例外，整条系列不动） */
  taskSkipInstance: 'task:skip-instance',

  // ---- 习惯计数器 ----
  habitList: 'habit:list',
  habitCreate: 'habit:create',
  habitUpdate: 'habit:update',
  habitDelete: 'habit:delete',
  /** 写入某一天的值（点击 +1 与秒表累计都由渲染层算好新值后送进来） */
  habitSetValue: 'habit:set-value',

  // ---- 日切（结束今天） ----
  /** 把 from 那天未完成的任务整体顺延到 to */
  dayRollover: 'day:rollover',

  // ---- 计划块 ----
  planList: 'plan:list',
  planGenerate: 'plan:generate',
  planCommit: 'plan:commit',
  planDiscard: 'plan:discard',
  planClear: 'plan:clear',
  /** 删除单个计划块（时间轴右键删除） */
  planRemove: 'plan:remove',

  // ---- 计时 ----
  timerGet: 'timer:get',
  timerStart: 'timer:start',
  timerPause: 'timer:pause',
  timerReset: 'timer:reset',
  timerSkip: 'timer:skip',
  timerBreak: 'timer:break',
  timerAttachTask: 'timer:attach-task',
  /** 手动改写本轮倒计时（分/秒），只影响当前这一轮，不写回 settings */
  timerSetDuration: 'timer:set-duration',
  /** 心流模式：结束本轮专注，按配置计算休息时长 */
  timerFinishFlow: 'timer:finish-flow',
  /** 空闲回处理：把离开的这段时长补回剩余时间（等效于离开期间暂停） */
  timerDiscardIdle: 'timer:discard-idle',

  // ---- 会话与统计 ----
  sessionList: 'session:list',
  statRange: 'stat:range',
  taskTop: 'stat:top',
  weeklyReport: 'stat:weekly-report',

  // ---- 设置 ----
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',

  // ---- 主题 ----
  themeGet: 'theme:get',
  themeSet: 'theme:set',
  themeSystemChanged: 'theme:system-changed',

  // ---- 窗口 ----
  windowAction: 'window:action',
  windowState: 'window:state',

  // ---- 系统 ----
  sysOpenDataDir: 'sys:open-data-dir',
  sysOpenExternal: 'sys:open-external',
  sysExport: 'sys:export',
  sysImport: 'sys:import',
  sysClearData: 'sys:clear-data',
  sysPickBackground: 'sys:pick-background',
  sysBackgrounds: 'sys:backgrounds',
  sysRemoveBackground: 'sys:remove-background',
  sysPlatformInfo: 'sys:platform-info',
  sysSetLoginItem: 'sys:set-login-item',
  sysShortcutStatus: 'sys:shortcut-status',

  // ---- 主进程 → 渲染层 推送 ----
  pushTimer: 'push:timer',
  pushTheme: 'push:theme',
  pushTrayCommand: 'push:tray-command',
  pushDataChanged: 'push:data-changed',
  pushNotify: 'push:notify',
  pushSecondWindow: 'push:second-window',
  /** 空闲检测：用户离开超过阈值后回来时推送，携带离开时长（秒） */
  pushIdle: 'push:idle'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

// ============================================================
//  zod schema —— 所有 IPC 出入参
// ============================================================

export const zThemeMode = z.enum(['system', 'light', 'dark'])
export const zLang = z.enum(['zh', 'en'])
export const zEffectiveTheme = z.enum(['light', 'dark'])
export const zPhase = z.enum(['focus', 'shortBreak', 'longBreak'])
export const zTimerStatus = z.enum(['IDLE', 'RUNNING', 'PAUSED'])
export const zPriority = z.union([z.literal(0), z.literal(1), z.literal(2)])
export const zCategory = z.enum(['work', 'life', 'study', 'health', 'other'])
export const zTaskStatus = z.enum(['todo', 'doing', 'done', 'archived'])
export const zRepeat = z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly'])
export const zMonthlyMode = z.enum(['date', 'nthWeekday', 'lastDay'])
export const zMonthlyWeekOfMonth = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(-1)
])
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
export const zTime = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, '时间格式必须为 HH:mm')
export const zId = z.string().min(1).max(128)
/**
 * 任意 URL 字符串（file:// 本地文件、https:// 外链）。
 * ⚠️ 绝不能拿 zId（上限 128）来校验它 —— URL 经 percent-encoding 后很容易
 *    超过 128 字符（例：中文名截图的 file:// URL ≈ 128，带查询串的外链更长的多），
 *    一超就被 zod 判非法 → 删除背景图 / 打开外链直接失败。
 */
export const zUrl = z.string().min(1).max(2048)
/**
 * 倒计时手动设定的秒数上限：
 * 显示为 MM:SS，分位最多两位（99 分钟），所以上限 99:59。
 */
export const zTimerSeconds = z.number().int().min(0).max(99 * 60 + 59)

export const zChecklistItem = z.object({
  id: zId,
  text: z.string().max(500),
  done: z.boolean()
})

export const zTask = z.object({
  id: zId,
  title: z.string().min(1).max(300),
  note: z.string().max(5000).optional(),
  date: zDate.nullable(),
  startTime: zTime.optional(),
  endTime: zTime.optional(),
  priority: zPriority,
  category: zCategory,
  tags: z.array(z.string().max(50)).max(50),
  checklist: z.array(zChecklistItem).max(200),
  estimatedPomodoros: z.number().int().min(0).max(50),
  completedPomodoros: z.number().int().min(0).max(999),
  status: zTaskStatus,
  repeat: zRepeat,
  repeatUntil: zDate.optional(),
  /*
   * 以下重复规则增强字段**全部 optional**。
   * 旧数据文件里没有它们；声明为必填会让整份数据校验失败并被当成损坏清空。
   */
  repeatEvery: z.number().int().min(1).max(52).optional(),
  monthlyMode: zMonthlyMode.optional(),
  monthlyWeekOfMonth: zMonthlyWeekOfMonth.optional(),
  monthlyWeekday: z.number().int().min(0).max(6).optional(),
  skipOverdue: z.boolean().optional(),
  deletedInstanceDates: z.array(zDate).max(1000).optional(),
  /**
   * 待确认标记。
   * ⚠️ 必须 optional：旧数据文件里没有这个字段，
   *    声明为必填会让整份数据校验失败并被当成损坏清空。
   */
  pending: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().optional()
})

export const zHabit = z.object({
  id: zId,
  title: z.string().min(1).max(100),
  type: z.enum(['click', 'stopwatch']),
  dailyTarget: z.number().int().min(1).max(100000),
  /** 'YYYY-MM-DD' → 数值。键是日期，不再逐个校验格式以免影响性能 */
  entries: z.record(z.number().min(0)),
  streakNeedsTarget: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const zSession = z.object({
  id: zId,
  taskId: zId.optional(),
  phase: zPhase,
  plannedSeconds: z.number().int().min(0),
  actualSeconds: z.number().int().min(0),
  startedAt: z.number(),
  endedAt: z.number(),
  completed: z.boolean(),
  skipped: z.boolean().optional()
})

export const zDailyStat = z.object({
  date: zDate,
  focusCount: z.number().int().min(0),
  focusSeconds: z.number().int().min(0),
  tasksDone: z.number().int().min(0)
})

export const zPlanBlock = z.object({
  id: zId,
  taskId: zId,
  date: zDate,
  startTime: zTime,
  endTime: zTime,
  phase: zPhase,
  index: z.number().int().min(0),
  consumed: z.boolean(),
  createdAt: z.number()
})

export const zDndRange = z.object({ from: zTime, to: zTime })

export const zSettings = z.object({
  language: zLang,
  theme: zThemeMode,
  autoSwitch: z.boolean(),
  autoDarkFrom: zTime,
  autoLightFrom: zTime,
  durations: z.object({
    workMinutes: z.number().int().min(1).max(180),
    shortBreakMinutes: z.number().int().min(1).max(60),
    longBreakMinutes: z.number().int().min(1).max(180)
  }),
  longBreakEvery: z.number().int().min(1).max(12),
  /*
   * ⚠️ 下面这些是后加的字段，**每一个都必须给 .default()**。
   *    旧数据文件里没有它们；声明为必填会让整份设置校验失败
   *    → coerce() 判定数据损坏 → 用户任务被清空。
   *    （这条在 background.rain 上已经吃过一次亏，此处不再重复。）
   * ⚠️ zod 的 .default(v) 是**短路**的：input 为 undefined 时直接返回 v，
   *    不会再跑内层 schema。所以对象类默认值必须写「完整对象」，不能写 {}。
   */
  focusMode: z.enum(['pomodoro', 'flowtime']).default('pomodoro'),
  flowtime: z
    .object({
      breakEnabled: z.boolean().default(true),
      breakMode: z.enum(['ratio', 'rules']).default('ratio'),
      breakPercent: z.number().int().min(5).max(100).default(20),
      breakRules: z
        .array(
          z.object({
            minMinutes: z.number().int().min(0).max(1440),
            maxMinutes: z.number().int().min(0).max(1440).nullable(),
            breakMinutes: z.number().int().min(1).max(180)
          })
        )
        .max(20)
        .default([
          { minMinutes: 0, maxMinutes: 30, breakMinutes: 5 },
          { minMinutes: 30, maxMinutes: 60, breakMinutes: 8 },
          { minMinutes: 60, maxMinutes: null, breakMinutes: 10 }
        ])
    })
    .default({
      breakEnabled: true,
      breakMode: 'ratio',
      breakPercent: 20,
      breakRules: [
        { minMinutes: 0, maxMinutes: 30, breakMinutes: 5 },
        { minMinutes: 30, maxMinutes: 60, breakMinutes: 8 },
        { minMinutes: 60, maxMinutes: null, breakMinutes: 10 }
      ]
    }),
  idle: z
    .object({
      enabled: z.boolean().default(false),
      minMinutes: z.number().int().min(1).max(120).default(5)
    })
    .default({ enabled: false, minMinutes: 5 }),
  focusSound: z.enum(['off', 'tick', 'whiteNoise']).default('off'),
  focusSoundVolume: z.number().min(0).max(1).default(0.4),
  dailyPomodoroLimit: z.number().int().min(1).max(50),
  strictMode: z.boolean(),
  autoStartNextPhase: z.boolean(),
  soundEnabled: z.boolean(),
  soundVolume: z.number().min(0).max(1),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  weekendDays: z.array(z.number().int().min(0).max(6)),
  defaultTaskMinutes: z.number().int().min(5).max(600),
  dnd: zDndRange,
  dndEnabled: z.boolean(),
  notifications: z.object({
    phaseDone: z.boolean(),
    taskGoalReached: z.boolean(),
    dailyGoalReached: z.boolean(),
    leadMinutes: z.number().int().min(0).max(120)
  }),
  background: z.object({
    enabled: z.boolean(),
    rotate: z.boolean(),
    rotateSeconds: z.number().int().min(5).max(600),
    /**
     * 雨点效果开关。
     * ⚠️ 必须给 .default(true)：旧数据文件里没有这个字段，
     *    若声明为必填，zod 会判整份设置非法 → 用户数据被当成损坏并清空。
     *    （这条在上一次加 hidden 时吃过一次亏，此处不再重复。）
     */
    rain: z.boolean().default(true),
    /**
     * 雨点大小（0..100，50 = 1.00×）。
     * ⚠️ 同 rain：必须给 .default(50) —— 旧数据文件里没有这个字段，
     *    声明为必填会让整份设置校验失败 → 用户数据被当成损坏并清空。
     */
    rainSize: z.number().min(0).max(100).default(50),
    order: z.array(z.string()),
    /**
     * 已从应用里移除的背景图（磁盘原图不动）。
     * ⚠️ 必须给 .default([])：旧数据文件里没有这个字段，
     *    若声明为必填，zod 会判整份设置非法 → 用户数据被当成损坏并清空。
     */
    hidden: z.array(zUrl).max(500).default([]),
    overlay: z.number().min(0).max(100),
    blur: z.number().min(0).max(40),
    vignette: z.number().min(0).max(100),
    autoTextColor: z.boolean()
  }),
  closeToTray: z.boolean(),
  openAtLogin: z.boolean(),
  sidebarCollapsed: z.boolean(),
  windowBounds: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number(),
      height: z.number()
    })
    .optional(),
  lastFullscreen: z.boolean(),
  onboardingDone: z.boolean()
})

export const zTimerState = z.object({
  phase: zPhase,
  status: zTimerStatus,
  taskId: z.string().nullable(),
  endsAt: z.number().nullable(),
  remainingSeconds: z.number().min(0),
  /** 后加字段：给默认值，避免旧快照校验失败 */
  elapsedSeconds: z.number().min(0).default(0),
  countingUp: z.boolean().default(false),
  cycleIndex: z.number().int().min(0),
  phaseStartedAt: z.number().nullable(),
  strictMode: z.boolean(),
  interruptCount: z.number().int().min(0)
})

export const zPersistedData = z.object({
  schemaVersion: z.number().int().min(1),
  tasks: z.array(zTask),
  planBlocks: z.array(zPlanBlock),
  sessions: z.array(zSession),
  dailyStats: z.array(zDailyStat),
  /** 习惯计数器：旧文件里没有这个键，必须给默认值 */
  habits: z.array(zHabit).default([]),
  settings: zSettings
})

// ---- 载荷 ----

export const zTaskDraft = zTask
  .partial()
  .extend({ title: z.string().min(1).max(300) })
  .refine((t) => t.date !== undefined || t.id === undefined, { message: 'date 需为合法日期或 null' })

export const zPlanRequest = z.object({
  taskIds: z.array(zId).min(1).max(50),
  date: zDate,
  windowStart: zTime,
  windowEnd: zTime,
  longBreakEvery: z.number().int().min(1).max(12).optional()
})

export const zStatQuery = z.object({
  from: zDate,
  to: zDate
})

export const zWindowAction = z.enum([
  'focus-fullscreen',
  'focus-windowed',
  'toggle-fullscreen',
  'open-workbench',
  'open-settings',
  'minimize',
  'close',
  'show'
])

export const zSettingsPatch = zSettings.partial()

export type TaskDraft = z.infer<typeof zTaskDraft>
export type PlanRequestPayload = z.infer<typeof zPlanRequest>
export type StatQuery = z.infer<typeof zStatQuery>
export type WindowAction = z.infer<typeof zWindowAction>
export type SettingsPatch = z.infer<typeof zSettingsPatch>
export type PersistedDataPayload = z.infer<typeof zPersistedData>

export const zHabitDraft = zHabit.partial().extend({ title: z.string().min(1).max(100) })

export const zHabitSetValue = z.object({
  id: zId,
  date: zDate,
  /** 新值（不是增量）。0 表示清空这一天 */
  value: z.number().min(0).max(1_000_000)
})

export const zDayRollover = z.object({ from: zDate, to: zDate })

export const zSkipInstance = z.object({ taskId: zId, date: zDate })

/**
 * 删除任务时留下的快照，供「撤销」原样写回。
 * ⚠️ 必须连 planBlocks 一起留着：任务被删时计划块也被级联删掉了，
 *    只恢复任务会让番茄计划凭空消失。
 */
export const zDeletedTaskSnapshot = z.object({
  task: zTask,
  planBlocks: z.array(zPlanBlock)
})

export type HabitDraft = z.infer<typeof zHabitDraft>
export type HabitSetValuePayload = z.infer<typeof zHabitSetValue>
export type DayRolloverPayload = z.infer<typeof zDayRollover>
export type SkipInstancePayload = z.infer<typeof zSkipInstance>
export type DeletedTaskSnapshot = z.infer<typeof zDeletedTaskSnapshot>

// ============================================================
//  跨端返回结构
// ============================================================

/** 启动引导一次性返回的全部数据 */
export interface BootstrapPayload {
  tasks: Task[]
  planBlocks: PlanBlock[]
  sessions: Session[]
  dailyStats: DailyStat[]
  habits: Habit[]
  settings: Settings
  timer: TimerState
  effectiveTheme: EffectiveTheme
  platformInfo: PlatformInfo
  /** 后台图 file:// URL 列表（已按 pathToFileURL 转换） */
  backgrounds: string[]
  soundUrl: string
  /** 旧版 ~/.pomodoro_stats.json 是否已迁移 */
  legacyMigrated: boolean
}

/** 平台能力信息，由 platform.ts 组装 */
export interface PlatformInfo {
  os: 'darwin' | 'win32' | 'other'
  platformLabel: string
  version: string
  /** 构建号（macOS 包的 CFBundleVersion；开发态为 'dev'） */
  build: string
  electron: string
  fontStack: string
  /** keyLabel 渲染好的符号 */
  keys: { mod: string; alt: string; shift: string }
  supportsTitleBarOverlayOptions: boolean
  supportsVibrancyOptions: boolean
  supportsMaterialOptions: boolean
  trayNoun: string
  sleepNoun: string
  defaultCloseToTray: boolean
  /** 实际生效的窗口装饰，供调试与视觉一致性核对。
   *  ⚠️ 直接复用 WindowChrome，别再手抄一份 —— 早先这里是结构副本，
   *     给 WindowChrome 加了 trafficLightRight/CenterY 后两边立刻漂移，
   *     渲染层拿不到新字段（编译期报错才发现）。 */
  chrome: import('./platform').WindowChrome
}

/** 统计区间聚合结果 */
export interface StatRangePayload {
  focusCount: number
  focusSeconds: number
  tasksDone: number
  totalSessions: number
  completedSessions: number
  completionRate: number
  avgFocusSecondsPerDay: number
  /** 近 14 日：日期 → 完成番茄数 */
  daily: { date: string; count: number; target: number }[]
  /** 分类占比 */
  byCategory: { category: string; seconds: number; count: number }[]
  /** 7×24 时段热力 */
  heatmap: number[][]
  /** 时间流向：24 个时段 → 各类别秒数 */
  flow: { category: string; seconds: number }[][]
  /** 节律三段占比 */
  dayparts: { part: 'morning' | 'afternoon' | 'evening'; count: number }[]
  /** 近一年每日专注量，热力图用 */
  year: { date: string; count: number }[]
}

export interface TaskTopPayload {
  taskId: string
  title: string
  seconds: number
  count: number
}

export interface WeeklyReportPayload {
  markdown: string
  from: string
  to: string
}

export interface SysPlatformPayload {
  info: PlatformInfo
}

export interface ShortcutStatus {
  accelerator: string
  registered: boolean
  label: string
}

export interface PlanPreviewPayload {
  blocks: PlanPreviewBlock[]
  /** 因勿扰/上限/时间窗不足而被跳过的原因统计 */
  skipped: { reason: string; count: number }[]
}

export interface TrayCommandPayload {
  command: 'start' | 'pause' | 'reset' | 'skip' | 'break' | 'show' | 'new-task'
}

/** 导出文件名固定规则：focusos-export-YYYYMMDD.json */
export function exportFileName(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `focusos-export-${y}${m}${d}.json`
}

export type { Task, Session, DailyStat, PlanBlock, Settings, TimerState, EffectiveTheme, ThemeMode, PlanPreviewBlock, Habit }
