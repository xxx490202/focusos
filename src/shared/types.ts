// ============================================================
//  types.ts — 全工程共享类型（前后端唯一真源的一部分）
// ============================================================
import type { Lang } from './i18n'

export type { Lang }

export type ThemeMode = 'system' | 'light' | 'dark'
export type EffectiveTheme = 'light' | 'dark'

export type TimerPhase = 'focus' | 'shortBreak' | 'longBreak'
export type TimerStatus = 'IDLE' | 'RUNNING' | 'PAUSED'

export interface TimerState {
  phase: TimerPhase
  status: TimerStatus
  taskId: string | null
  /** 权威结束时间戳（ms）。非 RUNNING 时为 null */
  endsAt: number | null
  /** 当前显示秒数（渲染层直接消费，不自行递减） */
  remainingSeconds: number
  /**
   * 已专注秒数（正计时）。
   * ⭐ 只有心流模式（focusMode='flowtime'）的专注阶段才会增长；
   *    番茄钟模式恒为 0。渲染层据此决定显示「倒计时」还是「正计时」。
   */
  elapsedSeconds: number
  /** 当前处于心流正计时（无结束点）而不是倒计时 */
  countingUp: boolean
  /** 本轮已完成专注数，用于判断长休息 */
  cycleIndex: number
  /** 本阶段开始的绝对时间戳（用于统计 actualSeconds） */
  phaseStartedAt: number | null
  /** 严格模式：专注中不允许暂停 */
  strictMode: boolean
  /** 中断次数（严格模式下强行退出计入） */
  interruptCount: number
}

export type Priority = 0 | 1 | 2
export type Category = 'work' | 'life' | 'study' | 'health' | 'other'
export type TaskStatus = 'todo' | 'doing' | 'done' | 'archived'
export type RepeatRule = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'

/**
 * 「每月」重复的锚点方式。
 * · date       —— 按起始日期的「几号」（默认，兼容旧数据）
 * · nthWeekday —— 按「第几个星期几」，如每月第一个周四
 * · lastDay    —— 每月最后一天（28/29/30/31 自动跟随），与起始日期的号数无关
 */
export type MonthlyMode = 'date' | 'nthWeekday' | 'lastDay'

/** 1..4 = 第 1~4 个；-1 = 当月最后一个 */
export type MonthlyWeekOfMonth = 1 | 2 | 3 | 4 | -1


export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Task {
  id: string
  title: string
  note?: string
  /** 'YYYY-MM-DD'；null = 未排期（进收件箱） */
  date: string | null
  /** 'HH:mm' */
  startTime?: string
  endTime?: string
  priority: Priority
  category: Category
  tags: string[]
  checklist: ChecklistItem[]
  estimatedPomodoros: number
  completedPomodoros: number
  status: TaskStatus
  repeat: RepeatRule
  repeatUntil?: string
  /**
   * 每隔 n 个周期重复一次（默认 1）。
   * · weekly  → 每 n 周
   * · monthly → 每 n 月
   * · daily / weekdays 忽略此字段
   */
  repeatEvery?: number
  /** 「每月」的锚点方式，不填按 'date' 处理（兼容旧数据） */
  monthlyMode?: MonthlyMode
  /** monthlyMode='nthWeekday' 时生效 */
  monthlyWeekOfMonth?: MonthlyWeekOfMonth
  /** monthlyMode='nthWeekday' 时生效，0=周日 … 6=周六 */
  monthlyWeekday?: number
  /**
   * 不展开「已经过去」的实例。
   * ⭐ 用户场景：一个月视图里，重复任务会把整月过去的日子全铺满，
   *    看上去像一堆没做完的欠账。打开这个开关就只从今天开始展开。
   */
  skipOverdue?: boolean
  /**
   * 单日例外：这些日期上的这一次不生成（'YYYY-MM-DD'）。
   *
   * ⭐ 没有这个字段时，「删除重复日程里的某一次」只能删整条系列 ——
   *    用户想删的往往只是这周四那一次（放假/改期）。
   */
  deletedInstanceDates?: string[]
  /**
   * 待确认（尚未落定的日程）。
   *
   * ⭐ 语义：新建出来的日程事件默认不是「已排期」，而是「待确认」——
   *    在日视图 / 周视图里以灰字 + 空心圆呈现，用户点掉空心圆才算真正排定。
   *    · `true` = 待确认；`false` / `undefined` = 已确认
   *    · 旧数据没有这个字段，因此**必须可选**，否则 zod 会把整份数据判为损坏并清空
   */
  pending?: boolean
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface Session {
  id: string
  taskId?: string
  phase: TimerPhase
  plannedSeconds: number
  actualSeconds: number
  startedAt: number
  endedAt: number
  /** 是否自然走完 —— 只有 completed 的 focus 才计入完成番茄数 */
  completed: boolean
  skipped?: boolean
}

export interface DailyStat {
  date: string
  focusCount: number
  focusSeconds: number
  tasksDone: number
}

// ---------------- 习惯计数器 ----------------

/**
 * 习惯类型。
 * · click     —— 点一下 +1（喝水、俯卧撑…）
 * · stopwatch —— 计时累计（冥想、阅读…），单位为秒
 */
export type HabitType = 'click' | 'stopwatch'

export interface Habit {
  id: string
  title: string
  type: HabitType
  /** 每日目标值：click 型为次数，stopwatch 型为秒数 */
  dailyTarget: number
  /**
   * 每日实际值：'YYYY-MM-DD' → 数值。
   * ⚠️ 只保留有记录的日子，没记录的日期视为 0 —— 不要写 0 进去，
   *    否则数据文件会随使用天数无限膨胀。
   */
  entries: Record<string, number>
  /** 连续打卡天数是否按「达到 dailyTarget」判定（false = 只要 >0 就算） */
  streakNeedsTarget: boolean
  createdAt: number
  updatedAt: number
}


/** 自动番茄计划生成出来的块（与任务块同屏渲染） */
export interface PlanBlock {
  id: string
  taskId: string
  date: string
  startTime: string
  endTime: string
  phase: TimerPhase
  /** 在该任务序列中的第几个专注块 */
  index: number
  /** 是否已被实际执行过 */
  consumed: boolean
  createdAt: number
}

// ---------------- Settings ----------------

export interface PhaseDurations {
  workMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
}

export interface DndRange {
  /** 'HH:mm'，from > to 视为跨零点，如 22:00–08:00 */
  from: string
  to: string
}

export interface BackgroundSettings {
  enabled: boolean
  /**
   * 是否轮播。
   * ⚠️ 关闭时**只用 order 里的第一张**当固定背景（不是随机、也不是最后一张）。
   */
  rotate: boolean
  /** 轮播间隔（秒） */
  rotateSeconds: number
  /**
   * 雨点效果：背景图之上叠一层 canvas 雨丝，点击画面泛起涟漪。
   * ⚠️ 只有「启用背景」时才生效 —— 没有背景图时下雨会显得莫名其妙。
   */
  rain: boolean
  /**
   * 雨点大小（0..100，50 = 1.00×，映射见 backgrounds.ts 的 rainSizeScale）。
   * 缩放雨丝的粗细与长度；只在雨点开启时有意义。
   */
  rainSize: number
  /**
   * 背景图的展示顺序（file:// URL 数组）。
   * · 由设置页拖拽排序写入；第一张即「不轮播时」显示的那张
   * · 未列进 order 的图片按原扫描顺序追加在其后，保证新导入的图不会消失
   */
  order: string[]
  /**
   * 用户从应用里「移除」掉的背景图（file:// URL 数组）。
   *
   * ⭐ 语义已明确为**只在应用内移除**：删除按钮永远不动磁盘文件，
   *    用户导入的原图始终留在电脑上（和「从列表移除」一个道理）。
   *    列在此处的 URL 会被 visibleBackgrounds() 过滤掉：
   *    既不出现在缩略图列表，也不参与轮播。
   *
   * 想要真正从电脑上删掉，走「移入系统废纸篓」那个独立入口 ——
   * 两条路径分开，避免「只想从列表里去掉」却把原图删没了。
   */
  hidden: string[]
  /** 遮罩强度 0–100（默认 30） */
  overlay: number
  /** 模糊半径 px */
  blur: number
  /** 暗角强度 0–100 */
  vignette: number
  /** 自动依据背景亮度反转文字色 */
  autoTextColor: boolean
}

export interface NotificationSettings {
  phaseDone: boolean
  taskGoalReached: boolean
  dailyGoalReached: boolean
  /** 提前量（分钟） */
  leadMinutes: number
}

// ---------------- 专注模式（番茄钟 / 心流） ----------------

export type FocusMode = 'pomodoro' | 'flowtime'

/** 心流模式下「休息多久」的两种算法 */
export type FlowtimeBreakMode = 'ratio' | 'rules'

/**
 * 心流模式的分段休息规则。
 * 半开区间：[minMinutes, maxMinutes)；maxMinutes 为 null 表示上不封顶。
 */
export interface FlowtimeBreakRule {
  minMinutes: number
  maxMinutes: number | null
  breakMinutes: number
}

export interface FlowtimeSettings {
  /** 心流停止后是否自动进入休息 */
  breakEnabled: boolean
  breakMode: FlowtimeBreakMode
  /** breakMode='ratio' 时生效：休息 = 已专注 × 百分比（最少 1 分钟） */
  breakPercent: number
  /** breakMode='rules' 时生效 */
  breakRules: FlowtimeBreakRule[]
}

// ---------------- 空闲检测 ----------------

export interface IdleSettings {
  enabled: boolean
  /** 连续无操作超过这个分钟数才算「离开了」 */
  minMinutes: number
}

/** 专注时的环境音 */
export type FocusSound = 'off' | 'tick' | 'whiteNoise'

export interface Settings {
  /** 界面语言：zh 简体中文 / en English */
  language: Lang
  theme: ThemeMode
  /** 'system' 模式下的日落自动切换 */
  autoSwitch: boolean
  autoDarkFrom: string
  autoLightFrom: string

  durations: PhaseDurations
  /** 每 N 个专注后插长休息 */
  longBreakEvery: number
  /**
   * 专注模式：番茄钟（倒计时）或心流（正计时，停下来才结算）。
   * ⚠️ 新字段必须给默认值（见 defaults.ts），旧数据文件里没有它。
   */
  focusMode: FocusMode
  flowtime: FlowtimeSettings
  idle: IdleSettings
  /** 专注进行中的环境音：关 / 滴答 / 白噪音 */
  focusSound: FocusSound
  /** 环境音音量 0–1（与提示音分开，专注时不想被提示音的音量带着走） */
  focusSoundVolume: number
  /** 每日番茄上限 */
  dailyPomodoroLimit: number
  strictMode: boolean
  autoStartNextPhase: boolean
  soundEnabled: boolean
  soundVolume: number

  weekStartsOn: 0 | 1
  weekendDays: number[]
  defaultTaskMinutes: number
  dnd: DndRange
  dndEnabled: boolean

  notifications: NotificationSettings

  background: BackgroundSettings

  closeToTray: boolean
  openAtLogin: boolean
  /** 左侧导航栏是否收起为窄条（仅图标） */
  sidebarCollapsed: boolean

  /** 小窗/全屏切换时记忆的窗口尺寸与位置 */
  windowBounds?: { x?: number; y?: number; width: number; height: number }
  lastFullscreen: boolean
  onboardingDone: boolean
}

// ---------------- 视图 & 窗口模式 ----------------

export type ViewId = 'focus' | 'day' | 'week' | 'inbox' | 'insights' | 'settings'
export type WindowMode = 'workbench' | 'focusWindow' | 'settings'

// ---------------- 持久化根结构 ----------------

export interface PersistedData {
  schemaVersion: number
  tasks: Task[]
  planBlocks: PlanBlock[]
  sessions: Session[]
  dailyStats: DailyStat[]
  /** 习惯计数器（旧数据文件里没有，读取时补空数组） */
  habits: Habit[]
  settings: Settings
}

// ---------------- 迁移结果 ----------------

export interface MigrationOutcome {
  data: PersistedData
  fromVersion: number
  toVersion: number
  /** 是否检测到旧版 ~/.pomodoro_stats.json 并完成转换 */
  legacyMigrated: boolean
}

// ---------------- 生成番茄计划的输入 / 输出 ----------------

export interface PlanRequest {
  taskIds: string[]
  /** 'YYYY-MM-DD' */
  date: string
  /** 'HH:mm' */
  windowStart: string
  windowEnd: string
  /** 每 N 个专注后插长休息（缺省取 settings.longBreakEvery） */
  longBreakEvery?: number
}

export interface PlanPreviewBlock {
  taskId: string
  taskTitle: string
  date: string
  startTime: string
  endTime: string
  phase: TimerPhase
  index: number
}
