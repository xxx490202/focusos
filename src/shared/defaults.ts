// ============================================================
//  defaults.ts — 默认设置与工厂函数
// ============================================================
import type { Settings, Task, Session, DailyStat, PlanBlock, PersistedData, Habit } from './types'
import { defaultCloseToTray } from './platform'
import { DEFAULT_LANG } from './i18n'

export const SCHEMA_VERSION = 1

/** 纯对象（排除 null 与数组） */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 递归合并：用 patch 覆盖 base 的同名字段，patch 缺失的键保留 base 的值。
 *
 * ⚠️ 读档时必须用它，**不能用浅合并**。
 *    Settings 里有嵌套对象（background / durations / notifications / dnd）。
 *    浅合并 `{...defaults, ...stored}` 会让旧文件里的 background 整体覆盖默认值，
 *    于是「新版本给 background 新增的字段」在旧文件里全都缺失 →
 *    zod 校验失败 → 用户数据被判定为损坏并回退成空数据。
 *    深合并让「追加式」的字段演进天然向后兼容，不必每次动 schemaVersion。
 *
 * 规则：
 *  · undefined 不覆盖（保留 base）
 *  · 数组整体替换（顺序就是语义，不能逐项合并）
 */
export function mergeDeep<T extends object>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const b = out[k]
    out[k] = isPlainObject(b) && isPlainObject(v) ? mergeDeep(b, v) : v
  }
  return out as T
}

export function defaultSettings(): Settings {
  return {
    language: DEFAULT_LANG,
    theme: 'system',
    autoSwitch: false,
    autoDarkFrom: '20:00',
    autoLightFrom: '07:00',

    durations: {
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15
    },
    longBreakEvery: 4,
    /*
     * ⭐ 默认仍是番茄钟 —— 心流是可选模式，不改变老用户的既有节奏。
     */
    focusMode: 'pomodoro',
    flowtime: {
      breakEnabled: true,
      // 比例式最直观：默认真实工作时长的 20% 用来休息
      breakMode: 'ratio',
      breakPercent: 20,
      /*
       * 分段规则的默认值参考常见做法：
       *   不到 30 分钟 → 休 5 分；30–60 分 → 休 8 分；超过 60 分 → 休 10 分。
       * 半开区间 [min, max)，最后一条 maxMinutes = null 表示上不封顶。
       */
      breakRules: [
        { minMinutes: 0, maxMinutes: 30, breakMinutes: 5 },
        { minMinutes: 30, maxMinutes: 60, breakMinutes: 8 },
        { minMinutes: 60, maxMinutes: null, breakMinutes: 10 }
      ]
    },
    idle: {
      // 默认关：它会打断专注，必须由用户主动启用
      enabled: false,
      minMinutes: 5
    },
    focusSound: 'off',
    focusSoundVolume: 0.4,
    dailyPomodoroLimit: 12,
    strictMode: false,
    autoStartNextPhase: true,
    soundEnabled: true,
    soundVolume: 0.7,

    weekStartsOn: 1,
    weekendDays: [0, 6],
    defaultTaskMinutes: 60,
    dnd: { from: '22:00', to: '08:00' },
    dndEnabled: false,

    notifications: {
      phaseDone: true,
      taskGoalReached: true,
      dailyGoalReached: true,
      leadMinutes: 0
    },

    background: {
      enabled: false,
      // 默认开启轮播（保持原有行为：开了背景模式就会轮播）
      rotate: true,
      rotateSeconds: 30,
      // 默认开雨点：用户要的就是「有背景就有雨」，开关只是给不喜欢时关掉用
      rain: true,
      // 雨点大小 0..100（50 = 1.00×，映射见 backgrounds.ts 的 rainSizeScale）
      rainSize: 50,
      // 空数组 = 按扫描顺序；设置页拖拽后会写入实际顺序
      order: [],
      // 已从应用里移除的背景图（只在应用内移除，磁盘原图不动）
      hidden: [],
      overlay: 30,
      blur: 0,
      vignette: 0,
      autoTextColor: true
    },

    /**
     * 关窗行为默认值按平台区分（macOS 习惯留菜单栏，Windows 习惯关窗即退出）。
     * ⭐ 这一项不写死，由 platform.ts 的 defaultCloseToTray() 提供，
     *    因此「默认值」本身就完成了平台适配。
     */
    closeToTray: defaultCloseToTray(),
    openAtLogin: false,
    sidebarCollapsed: false,

    /**
     * ⚠️ 启动默认进「工作台」窗口，不要一开就是全屏。
     *    这一项会在 ready-to-show 时决定要不要 setFullScreen(true)，
     *    设为 true 会让每次启动直接顶成 macOS 全屏，
     *    用户还得先按一次 Esc 才能看到侧栏 —— 与「启动直接进工作台」相悖。
     *    （用户按 F 主动切全屏后，这里会被更新为 true，下次沿用，这是预期的。）
     */
    lastFullscreen: false,
    onboardingDone: false
  }
}

export function emptyData(): PersistedData {
  return {
    schemaVersion: SCHEMA_VERSION,
    tasks: [],
    planBlocks: [],
    sessions: [],
    dailyStats: [],
    habits: [],
    settings: defaultSettings()
  }
}

/** 生成短 id（不依赖 uuid 随机源依赖，主进程与渲染层共用） */
let idCounter = 0
export function makeId(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 0xffff
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36).padStart(3, '0')}_${Math.floor(
    Math.random() * 0xffffff
  ).toString(36)}`
}

export function makeTask(patch: Partial<Task> = {}): Task {
  const now = Date.now()
  return {
    id: makeId('task'),
    title: '',
    date: null,
    priority: 1,
    category: 'work',
    tags: [],
    checklist: [],
    estimatedPomodoros: 1,
    completedPomodoros: 0,
    status: 'todo',
    repeat: 'none',
    /*
     * ⭐ 新建任务默认**待确认**。
     *    早先默认是「已排期」——新建一个任务就直接以正式事件的样子出现在今日日程上，
     *    用户反馈「新建任务咋就直接出现在今日日程上了」。现在统一先待确认：
     *    时间轴上以灰字 + 空心圆呈现，用户点掉空心圆才算真正排定。
     */
    pending: true,
    createdAt: now,
    updatedAt: now,
    ...patch
  }
}

export function makeSession(patch: Partial<Session> & Pick<Session, 'phase'>): Session {
  const now = Date.now()
  return {
    id: makeId('ses'),
    plannedSeconds: 0,
    actualSeconds: 0,
    startedAt: now,
    endedAt: now,
    completed: false,
    ...patch
  }
}

export function makeDailyStat(date: string, patch: Partial<DailyStat> = {}): DailyStat {
  return { date, focusCount: 0, focusSeconds: 0, tasksDone: 0, ...patch }
}

export function makeHabit(patch: Partial<Habit> = {}): Habit {
  const now = Date.now()
  return {
    id: makeId('habit'),
    title: '',
    type: 'click',
    dailyTarget: 1,
    entries: {},
    streakNeedsTarget: true,
    createdAt: now,
    updatedAt: now,
    ...patch
  }
}

export function makePlanBlock(patch: Partial<PlanBlock> & Pick<PlanBlock, 'taskId' | 'date'>): PlanBlock {
  return {
    id: makeId('plan'),
    startTime: '09:00',
    endTime: '09:25',
    phase: 'focus',
    index: 0,
    consumed: false,
    createdAt: Date.now(),
    ...patch
  }
}

// ---------------- 展示用常量 ----------------

export const PHASE_LABEL: Record<'focus' | 'shortBreak' | 'longBreak', string> = {
  focus: '专注',
  shortBreak: '短休息',
  longBreak: '长休息'
}

export const PRIORITY_LABEL: Record<0 | 1 | 2, string> = {
  0: '低',
  1: '中',
  2: '高'
}

export const CATEGORY_LABEL: Record<Task['category'], string> = {
  work: '工作',
  life: '生活',
  study: '学习',
  health: '健康',
  other: '其他'
}

export const REPEAT_LABEL: Record<Task['repeat'], string> = {
  none: '不重复',
  daily: '每天',
  weekdays: '工作日',
  weekly: '每周',
  monthly: '每月'
}

export const TASK_STATUS_LABEL: Record<Task['status'], string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  archived: '已归档'
}
