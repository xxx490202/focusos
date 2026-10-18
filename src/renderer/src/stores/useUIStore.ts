// ============================================================
//  useUIStore.ts — 界面状态（视图、模态、toast、搜索）
// ============================================================
import { create } from 'zustand'
import type { ViewId, PlanPreviewBlock, RepeatRule } from '@shared/types'

export interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'success' | 'error'
  /** 可选操作按钮（目前用于「撤销」删除） */
  action?: ToastAction
  /** 带操作的提示通常需要多留一会儿，不传按 kind 取默认值 */
  durationMs?: number
}

/**
 * 二次确认请求。
 * ⚠️ 用 state 里的函数而不是 window.confirm：
 *    原生 confirm 会**阻塞主线程且样式不可控**，在 Electron 里还会卡住动画。
 */
export interface ConfirmRequest {
  title: string
  message: string
  /** 确认按钮文案，默认「删除」 */
  confirmLabel?: string
  /** 是否为破坏性操作（确认按钮用危险色） */
  danger?: boolean
  onConfirm: () => void | Promise<void>
}

/**
 * 时间轴上「日程事件」的右键菜单目标。
 * ⚠️ 与 taskMenu 分开：日程块可能是任务块，也可能是计划块（番茄计划），
 *    两者的删除语义完全不同 —— 计划块只删这一块，任务块删整个任务。
 */
export interface BlockMenuTarget {
  /** 时间轴上的块 id：任务块 = 任务 id；计划块 = PlanBlock id */
  blockId: string
  kind: 'task' | 'plan'
  /** 计划块需要回指源任务，供「编辑」跳转 */
  taskId: string | null
  title: string
  x: number
  y: number
  /**
   * 该块所在日期（'YYYY-MM-DD'）。
   * ⭐ 重复任务的实例需要它才能「只删这一次」——
   *    实例的 id 是 `任务id@日期`，但块 id 用的是基础任务 id。
   */
  date?: string
  /** 重复规则，用于决定菜单里要不要出现「只删除这一次」 */
  repeat?: RepeatRule
}

/**
 * 背景图缩略图的右键菜单目标。
 * 删除背景图是破坏性操作（会同时把它从轮播顺序里摘掉），
 * 因此和其它菜单一样：菜单 → 二次确认 → 才真的删。
 */
export interface BgMenuTarget {
  /** file:// URL */
  url: string
  index: number
  x: number
  y: number
}

interface UIState {
  view: ViewId
  /** 工作台 / 专注窗口 / 设置 */
  windowMode: 'workbench' | 'focusWindow'
  search: string
  searchOpen: boolean
  shortcutPanelOpen: boolean
  onboardingOpen: boolean
  /** 被编辑的任务 id，null = 新建 */
  editingTaskId: string | null
  taskModalOpen: boolean
  /** 日视图当前日期 */
  selectedDate: string
  /** 日视图小时格高：48 / 64 / 96 */
  hourHeight: 48 | 64 | 96
  /** 生成番茄计划的预览态 */
  planPreview: PlanPreviewBlock[]
  planPreviewDate: string | null
  toasts: Toast[]
  /** 任务卡右键菜单：屏幕坐标由点击时的 clientX/clientY 决定 */
  taskMenu: { taskId: string; x: number; y: number } | null
  /** 日程事件（时间轴块）右键菜单 */
  blockMenu: BlockMenuTarget | null
  /** 背景图缩略图右键菜单 */
  bgMenu: BgMenuTarget | null
  /** 通用二次确认对话框（破坏性操作必须先过这一关） */
  confirmDialog: ConfirmRequest | null
  /**
   * 空闲回处理对话框。
   * 主进程只负责「测出离开了多久」，要不要弹、弹完怎么补偿由这里决定。
   */
  idleDialog: { seconds: number } | null

  setView: (v: ViewId) => void
  setWindowMode: (m: 'workbench' | 'focusWindow') => void
  setSearch: (s: string) => void
  toggleSearch: () => void
  setShortcutPanel: (v: boolean) => void
  setOnboarding: (v: boolean) => void
  openTaskModal: (id?: string) => void
  closeTaskModal: () => void
  setSelectedDate: (d: string) => void
  setHourHeight: (h: 48 | 64 | 96) => void
  setPlanPreview: (blocks: PlanPreviewBlock[], date: string) => void
  clearPlanPreview: () => void
  toast: (text: string, kind?: Toast['kind']) => void
  /** 带操作按钮的提示（如删除后的「撤销」） */
  toastWithAction: (text: string, action: ToastAction, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
  openTaskMenu: (taskId: string, x: number, y: number) => void
  closeTaskMenu: () => void
  openBlockMenu: (t: BlockMenuTarget) => void
  closeBlockMenu: () => void
  openBgMenu: (t: BgMenuTarget) => void
  closeBgMenu: () => void
  /** 一次收起所有右键菜单（点空白 / Esc / 滚动时用） */
  closeMenus: () => void
  askConfirm: (req: ConfirmRequest) => void
  closeConfirm: () => void
  showIdleDialog: (seconds: number) => void
  closeIdleDialog: () => void
}

let toastId = 0

export const useUIStore = create<UIState>((set, get) => ({
  view: 'day',
  windowMode: 'workbench',
  search: '',
  searchOpen: false,
  shortcutPanelOpen: false,
  onboardingOpen: false,
  editingTaskId: null,
  taskModalOpen: false,
  selectedDate: todayKey(),
  hourHeight: 64,
  planPreview: [],
  planPreviewDate: null,
  toasts: [],
  taskMenu: null,
  blockMenu: null,
  bgMenu: null,
  confirmDialog: null,
  idleDialog: null,

  setView: (view) => set({ view }),
  setWindowMode: (windowMode) => set({ windowMode }),
  setSearch: (search) => set({ search }),
  toggleSearch: () => set({ searchOpen: !get().searchOpen }),
  setShortcutPanel: (shortcutPanelOpen) => set({ shortcutPanelOpen }),
  setOnboarding: (onboardingOpen) => set({ onboardingOpen }),
  openTaskModal: (id) => set({ taskModalOpen: true, editingTaskId: id ?? null }),
  closeTaskModal: () => set({ taskModalOpen: false, editingTaskId: null }),
  setSelectedDate: (selectedDate) => set({ selectedDate }),
  setHourHeight: (hourHeight) => set({ hourHeight }),
  setPlanPreview: (planPreview, planPreviewDate) => set({ planPreview, planPreviewDate }),
  clearPlanPreview: () => set({ planPreview: [], planPreviewDate: null }),

  toast: (text, kind = 'info') => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, kind }] })
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) })
    }, 2600)
  },

  /*
   * 带操作的提示。
   * ⚠️ 停留时间明显更长（8 秒）：普通的 2.6 秒是用来「扫一眼」的，
   *    而撤销按钮需要留出「用户发现自己删错了 → 手移过去点一下」的时间，
   *    太短等于没给后悔的机会。
   */
  toastWithAction: (text, action, kind = 'info') => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, kind, action, durationMs: 8000 }] })
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) })
    }, 8000)
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  openTaskMenu: (taskId, x, y) => set({ taskMenu: { taskId, x, y }, blockMenu: null, bgMenu: null }),
  closeTaskMenu: () => set({ taskMenu: null }),
  openBlockMenu: (blockMenu) => set({ blockMenu, taskMenu: null, bgMenu: null }),
  closeBlockMenu: () => set({ blockMenu: null }),
  openBgMenu: (bgMenu) => set({ bgMenu, taskMenu: null, blockMenu: null }),
  closeBgMenu: () => set({ bgMenu: null }),
  closeMenus: () => set({ taskMenu: null, blockMenu: null, bgMenu: null }),
  askConfirm: (confirmDialog) => {
    // 确认弹窗与右键菜单互斥：弹确认时先收起所有菜单
    set({ confirmDialog, taskMenu: null, blockMenu: null, bgMenu: null })
  },
  closeConfirm: () => set({ confirmDialog: null }),
  showIdleDialog: (seconds) => set({ idleDialog: { seconds } }),
  closeIdleDialog: () => set({ idleDialog: null })
}))

export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
