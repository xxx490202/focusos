// ============================================================
//  useThemeStore.ts — 主题状态
// ============================================================
//  ⭐ 切换主题不整页 reload：只改 <html data-theme> + meta color-scheme，
//     并通知主进程同步 nativeTheme / backgroundColor /
//     Windows 的 titleBarOverlay.symbolColor。
// ============================================================
import { create } from 'zustand'
import type { ThemeMode, EffectiveTheme } from '@shared/types'

interface ThemeState {
  mode: ThemeMode
  effective: EffectiveTheme
  setMode: (mode: ThemeMode) => Promise<void>
  setEffective: (t: EffectiveTheme) => void
  apply: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'system',
  effective: 'dark',

  setMode: async (mode) => {
    set({ mode })
    // ⭐ 禁止整页 reload
    await window.api.theme.set(mode)
    const r = await window.api.theme.get()
    if (r.ok) set({ effective: r.data.effective })
    get().apply()
  },

  /** 收到主进程推送（系统主题变化）时只更新 DOM，不 reload */
  setEffective: (effective) => {
    set({ effective })
    get().apply()
  },

  apply: () => {
    const { effective } = get()
    const root = document.documentElement
    root.dataset.theme = effective
    // 同步 color-scheme，影响原生滚动条与表单控件（两平台都需要）
    let meta = document.querySelector('meta[name="color-scheme"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'color-scheme')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', effective)
  }
}))
