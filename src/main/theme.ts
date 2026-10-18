// ============================================================
//  theme.ts — nativeTheme 同步 + 系统主题事件转发
// ============================================================
//  ⭐ 主题必须主进程与渲染层双向同步：
//     渲染层切换 → 通知主进程更新 nativeTheme.themeSource
//     与窗口 backgroundColor（Windows 还需 titleBarOverlay.symbolColor）
// ============================================================
import { nativeTheme } from 'electron'
import type { ThemeMode, EffectiveTheme, Settings } from '@shared/types'
import { resolveTheme, windowBackground, themeSource } from '@shared/theme-resolver'
import { windows } from './window'
import { scopedLogger } from './store/logger'

const log = scopedLogger('theme')

type Listener = (theme: EffectiveTheme) => void

class ThemeManager {
  private listeners = new Set<Listener>()
  /** 当前生效主题（缓存，避免重复计算） */
  private current: EffectiveTheme = 'dark'

  get current_(): EffectiveTheme {
    return this.current
  }

  /** 监听生效主题变化 */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /**
   * 应用主题：同步 nativeTheme + 所有窗口外观 + 通知渲染层。
   * 不触发整页 reload。
   */
  apply(mode: ThemeMode, settings: Settings): EffectiveTheme {
    const effective = resolveTheme(mode, settings, {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors
    })
    this.current = effective

    // 主进程侧同步（避免切换瞬间白闪）
    try {
      nativeTheme.themeSource = themeSource(mode)
    } catch (err) {
      log.warn('设置 themeSource 失败', err)
    }

    // ⭐ Windows 上还需同步 titleBarOverlay.symbolColor
    windows.applyChromeToWindowSafe(effective, windowBackground(effective))

    // 通知渲染层
    windows.broadcast('theme:system-changed', effective)
    for (const fn of this.listeners) fn(effective)
    return effective
  }

  /** 系统主题变化时转发（用户选 system 时无需重启即时跟随） */
  attachSystemListener(): void {
    nativeTheme.on('updated', () => {
      // system 模式下重新解析并转发；强制模式下不打扰用户
      log.debug('系统主题变化')
      const mode = this.currentMode
      if (mode !== 'system') return
      if (!this.currentSettings) return
      const effective = resolveTheme(mode, this.currentSettings, {
        shouldUseDarkColors: nativeTheme.shouldUseDarkColors
      })
      if (effective === this.current) return
      this.current = effective
      windows.broadcast('theme:system-changed', effective)
      for (const fn of this.listeners) fn(effective)
    })
  }

  /** 记录当前设置，供系统事件回调使用 */
  private currentMode: ThemeMode = 'system'
  private currentSettings: Settings | null = null

  remember(mode: ThemeMode, settings: Settings): void {
    this.currentMode = mode
    this.currentSettings = settings
  }
}

export const themeManager = new ThemeManager()
export { nativeTheme }
