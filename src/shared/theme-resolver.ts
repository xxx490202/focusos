// ============================================================
//  theme-resolver.ts — 主题解析（纯函数，可单测）
// ============================================================
//  规范第二部分第五节：
//  mode === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : mode
//  system 模式下可开启「日落自动切换」。
// ============================================================
import type { ThemeMode, EffectiveTheme, Settings } from './types'
import { timeToMinutes } from './schedule'

export interface SystemThemeInfo {
  /** nativeTheme.shouldUseDarkColors */
  shouldUseDarkColors: boolean
}

/**
 * 解析实际生效主题。
 *
 * @param mode       用户选择的模式
 * @param settings   完整设置（需要 autoSwitch / autoDarkFrom / autoLightFrom）
 * @param system     系统当前是否为深色
 * @param now        当前时间戳（单测可注入）
 */
export function resolveTheme(
  mode: ThemeMode,
  settings: Pick<Settings, 'autoSwitch' | 'autoDarkFrom' | 'autoLightFrom'>,
  system: SystemThemeInfo,
  now: number = Date.now()
): EffectiveTheme {
  // 强制模式：直接生效
  if (mode === 'light' || mode === 'dark') return mode

  // 跟随系统，但开启日落自动切换：
  // 当前时刻落在 [autoDarkFrom, autoLightFrom) 之间 → 强制深色（夜间）
  if (settings.autoSwitch) {
    const night = isNightWindow(now, settings.autoDarkFrom, settings.autoLightFrom)
    if (night !== null) return night ? 'dark' : 'light'
  }

  // 纯跟随系统
  return system.shouldUseDarkColors ? 'dark' : 'light'
}

/**
 * 判断当前时刻是否处于「夜间窗口」。
 * autoDarkFrom → autoLightFrom 之间视为夜间（默认 20:00–07:00，跨零点）。
 * 返回 null 表示配置无效或未启用。
 */
export function isNightWindow(
  now: number,
  darkFrom: string,
  lightFrom: string
): boolean | null {
  const d = new Date(now)
  const minutes = d.getHours() * 60 + d.getMinutes()
  const from = timeToMinutes(darkFrom)
  const to = timeToMinutes(lightFrom)
  if (from === null || to === null || from === to) return null

  if (from < to) {
    // 不跨零点，如 08:00–20:00 为夜间
    return minutes >= from && minutes < to
  }
  // 跨零点，如 20:00–07:00
  return minutes >= from || minutes < to
}

/** 窗口背景色：与 themes.css 的 --bg 保持一致，避免切换瞬间白闪 */
export function windowBackground(theme: EffectiveTheme): string {
  return theme === 'dark' ? '#1C1C1E' : '#F2F3F7'
}

/** meta color-scheme 值，影响原生滚动条与表单控件 */
export function colorScheme(theme: EffectiveTheme): 'dark' | 'light' {
  return theme
}

/** Electron nativeTheme.themeSource 取值 */
export function themeSource(mode: ThemeMode): 'system' | 'light' | 'dark' {
  return mode
}
