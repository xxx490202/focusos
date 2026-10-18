// ============================================================
//  preload/index.ts — contextBridge 白名单
// ============================================================
//  ⭐ 渲染进程零 Node 能力。所有能力经此白名单暴露。
//     只转发固定通道，不暴露 ipcRenderer 本身。
// ============================================================
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-contract'
import type {
  Task, PlanBlock, Session, Settings, TimerState,
  ThemeMode, PlatformInfo, Habit
} from '../shared/ipc-contract'
import type { StatRangePayload, TaskTopPayload, PlanPreviewPayload, SysPlatformPayload } from '../shared/ipc-contract'

export type InvokeResult<T> = { ok: true; data: T } | { ok: false; error: string }

function invoke<T>(channel: string, payload?: unknown): Promise<InvokeResult<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<InvokeResult<T>>
}

/** 只允许订阅白名单内的推送通道 */
const PUSH_CHANNELS = new Set<string>([
  'timer:tick',
  'timer:phase',
  'theme:system-changed',
  'tray:command',
  'data:changed',
  'sound:chime',
  'window:fullscreen-changed',
  'window:mode',
  /** 空闲检测：用户离开超过阈值后回来时推送 */
  'push:idle'
])

const api = {
  // ---- 启动引导 ----
  bootstrap: () => invoke<{
    tasks: Task[]
    planBlocks: PlanBlock[]
    sessions: Session[]
    dailyStats: import('@shared/types').DailyStat[]
    habits: Habit[]
    settings: Settings
    timer: TimerState
    effectiveTheme: 'light' | 'dark'
    platformInfo: PlatformInfo
    backgrounds: string[]
    soundUrl: string
    legacyMigrated: boolean
  }>(IPC.bootstrap),

  // ---- 任务 ----
  task: {
    list: () => invoke<Task[]>(IPC.taskList),
    create: (draft: unknown) => invoke<Task>(IPC.taskCreate, draft),
    update: (id: string, patch: unknown) => invoke<Task>(IPC.taskUpdate, { id, patch }),
    /**
     * 删除任务。返回值是可用于「撤销」的完整快照
     * （含任务本身 + 被级联删掉的计划块）。
     */
    remove: (id: string) => invoke<unknown>(IPC.taskDelete, id),
    /** 撤销删除：把快照原样写回 */
    restore: (snapshot: unknown) => invoke<boolean>(IPC.taskRestore, snapshot),
    /** 只跳过重复日程里的某一次（不影响整条系列） */
    skipInstance: (taskId: string, date: string) =>
      invoke<Task>(IPC.taskSkipInstance, { taskId, date }),
    duplicate: (id: string) => invoke<Task>(IPC.taskDuplicate, id),
    archive: (id: string) => invoke<Task>(IPC.taskArchive, id),
    complete: (id: string) => invoke<Task>(IPC.taskComplete, id)
  },

  // ---- 习惯计数器 ----
  habit: {
    list: () => invoke<Habit[]>(IPC.habitList),
    create: (draft: unknown) => invoke<Habit>(IPC.habitCreate, draft),
    update: (id: string, patch: unknown) => invoke<Habit>(IPC.habitUpdate, { id, patch }),
    remove: (id: string) => invoke<boolean>(IPC.habitDelete, id),
    setValue: (id: string, date: string, value: number) =>
      invoke<Habit>(IPC.habitSetValue, { id, date, value })
  },

  // ---- 结束今天 ----
  day: {
    /** 把 from 那天未完成的任务整体顺延到 to */
    rollover: (from: string, to: string) =>
      invoke<{ moved: number }>(IPC.dayRollover, { from, to })
  },

  // ---- 计划块 ----
  plan: {
    list: () => invoke<PlanBlock[]>(IPC.planList),
    generate: (req: unknown) => invoke<PlanPreviewPayload>(IPC.planGenerate, req),
    commit: (date: string) => invoke<PlanBlock[]>(IPC.planCommit, date),
    discard: () => invoke<boolean>(IPC.planDiscard),
    clear: (date: string, taskIds?: string[]) => invoke<boolean>(IPC.planClear, { date, taskIds }),
    /** 删除单个计划块（时间轴右键删除） */
    remove: (id: string) => invoke<boolean>(IPC.planRemove, id)
  },

  // ---- 计时 ----
  timer: {
    get: () => invoke<TimerState>(IPC.timerGet),
    start: () => invoke<TimerState>(IPC.timerStart),
    pause: () => invoke<TimerState>(IPC.timerPause),
    reset: () => invoke<TimerState>(IPC.timerReset),
    skip: () => invoke<TimerState>(IPC.timerSkip),
    break: () => invoke<TimerState>(IPC.timerBreak),
    attachTask: (id: string | null) => invoke<TimerState>(IPC.timerAttachTask, id),
    /**
     * 手动设定本轮倒计时（专注页点分/秒）。
     * 只影响当前这一轮，不会写回设置。
     */
    setDuration: (seconds: number) => invoke<TimerState>(IPC.timerSetDuration, seconds),
    /** 心流模式：结束本轮专注，按配置计算休息时长 */
    finishFlow: () => invoke<TimerState>(IPC.timerFinishFlow),
    /** 空闲回处理：把离开的时长补回剩余时间（等效于离开期间暂停） */
    discardIdle: (seconds: number) => invoke<TimerState>(IPC.timerDiscardIdle, seconds)
  },

  // ---- 统计 ----
  stats: {
    sessions: () => invoke<Session[]>(IPC.sessionList),
    range: (from: string, to: string) => invoke<StatRangePayload>(IPC.statRange, { from, to }),
    top: (from: string, to: string) => invoke<TaskTopPayload[]>(IPC.taskTop, { from, to }),
    weeklyReport: (from: string, to: string) => invoke<string>(IPC.weeklyReport, { from, to })
  },

  // ---- 设置 ----
  settings: {
    get: () => invoke<Settings>(IPC.settingsGet),
    patch: (patch: unknown) => invoke<{ settings: Settings; effectiveTheme: 'light' | 'dark' }>(IPC.settingsPatch, patch)
  },

  // ---- 主题 ----
  theme: {
    get: () => invoke<{ settings: Settings; effective: 'light' | 'dark' }>(IPC.themeGet),
    set: (mode: ThemeMode) => invoke<'light' | 'dark'>(IPC.themeSet, { theme: mode })
  },

  // ---- 窗口 ----
  window: {
    action: (action: string) => invoke<boolean>(IPC.windowAction, action),
    state: () => invoke<{
      today: string
      dataFile: string
      backgroundsDir: string
      shortcutHints: { accelerator: string; label: string }[]
      keys: { mod: string; alt: string; shift: string }
      platform: string
      appId: string
      defaultCloseToTray: boolean
    }>('system:info')
  },

  // ---- 时间轴 ----
  timeline: {
    blocks: (from: string, to: string) => invoke<import('@shared/schedule').TimeBlock[]>('timeline:blocks', { from, to })
  },

  // ---- 系统 ----
  sys: {
    openDataDir: () => invoke<boolean>(IPC.sysOpenDataDir),
    openExternal: (url: string) => invoke<boolean>(IPC.sysOpenExternal, url),
    exportData: () => invoke<string>(IPC.sysExport),
    importData: () => invoke<{ ok: boolean; message: string }>(IPC.sysImport),
    clearData: () => invoke<boolean>(IPC.sysClearData),
    pickBackground: () => invoke<string[]>(IPC.sysPickBackground),
    backgrounds: () => invoke<string[]>(IPC.sysBackgrounds),
    /**
     * 删除背景图 —— 只在应用里删，磁盘上的原图不受影响。
     * 'removed' 已从应用删除 | 'failed' 持久化失败
     */
    removeBackground: (url: string) => invoke<'removed' | 'failed'>(IPC.sysRemoveBackground, url),
    platformInfo: () => invoke<SysPlatformPayload>(IPC.sysPlatformInfo),
    setLoginItem: (enabled: boolean) => invoke<boolean>(IPC.sysSetLoginItem, { enabled }),
    shortcutStatus: () => invoke<boolean>(IPC.sysShortcutStatus)
  },

  // ============================================================
  //  推送订阅
  //  ⚠️ 组件卸载时必须调用返回的取消函数，防内存泄漏。
  // ============================================================
  on(channel: string, handler: (payload: unknown) => void): () => void {
    if (!PUSH_CHANNELS.has(channel)) {
      throw new Error(`不允许订阅通道: ${channel}`)
    }
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

export type FocusOsApi = typeof api

contextBridge.exposeInMainWorld('api', api)
