// ============================================================
//  useDataStore.ts — 数据镜像（Zustand 缓存主进程数据的只读副本）
// ============================================================
import { create } from 'zustand'
import type { Task, PlanBlock, Session, DailyStat, Settings, Habit } from '@shared/types'
import { defaultSettings } from '@shared/defaults'
import type { PlatformInfo } from '@shared/ipc-contract'

interface DataState {
  tasks: Task[]
  planBlocks: PlanBlock[]
  sessions: Session[]
  dailyStats: DailyStat[]
  habits: Habit[]
  settings: Settings
  platformInfo: PlatformInfo | null
  backgrounds: string[]
  soundUrl: string
  legacyMigrated: boolean
  ready: boolean

  setAll: (payload: {
    tasks: Task[]
    planBlocks: PlanBlock[]
    sessions: Session[]
    dailyStats: DailyStat[]
    habits: Habit[]
    settings: Settings
    platformInfo: PlatformInfo
    backgrounds: string[]
    soundUrl: string
    legacyMigrated: boolean
  }) => void
  setTasks: (t: Task[]) => void
  setSettings: (s: Settings) => void
  setBackgrounds: (b: string[]) => void
  reload: () => Promise<void>
}

export const useDataStore = create<DataState>((set) => ({
  tasks: [],
  planBlocks: [],
  sessions: [],
  dailyStats: [],
  habits: [],
  settings: defaultSettings(),
  platformInfo: null,
  backgrounds: [],
  soundUrl: '',
  legacyMigrated: false,
  ready: false,

  setAll: (p) => set({ ...p, ready: true }),
  setTasks: (tasks) => set({ tasks }),
  setSettings: (settings) => set({ settings }),
  setBackgrounds: (backgrounds) => set({ backgrounds }),

  /*
   * 重新拉取主进程数据。
   * ⚠️ 用 bootstrap 一次取全，而不是只取 tasks：
   *    · 早先只刷 tasks → 「删除一个计划块」后时间轴上那块仍在，
   *      要重开视图才消失；一个番茄自然走完后今日进度点阵也不更新
   *      （dailyStats 没被拉回来）。
   *    · 单次 IPC 往返也比分三次更省。
   * ⚠️ settings 也必须在其中：设置窗口是**独立 BrowserWindow**，
   *    在主窗口里改语言/主题后，另一个窗口只能靠 data:changed → 这里
   *    才能拿到新设置。少了它，设置窗口切语言主窗口不会跟。
   *    （不会成环：data:changed 只在真正写盘后广播一次，而本方法只读不写。）
   */
  reload: async () => {
    const r = await window.api.bootstrap()
    if (!r.ok) return
    set({
      tasks: r.data.tasks,
      planBlocks: r.data.planBlocks,
      sessions: r.data.sessions,
      dailyStats: r.data.dailyStats,
      habits: r.data.habits,
      settings: r.data.settings
    })
  }
}))

/** 今日已完成番茄数 */
export function todayFocusCount(stats: DailyStat[], today: string): number {
  return stats.find((s) => s.date === today)?.focusCount ?? 0
}
