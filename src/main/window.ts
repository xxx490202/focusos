// ============================================================
//  window.ts — 主窗口 / 全屏专注窗口 / 设置窗口
// ============================================================
//  ⭐ 装饰差异全部来自 platform.ts 的 windowChrome()，
//     本文件不出现 process.platform / isMac 字样。
// ============================================================
import { BrowserWindow, shell, screen } from 'electron'
import { join } from 'node:path'
import { windowChrome, defaultCloseToTray } from '@shared/platform'
import type { EffectiveTheme, Settings, WindowMode } from '@shared/types'
import { windowBackground } from '@shared/theme-resolver'
import { isDev, appRoot } from './paths'
import { scopedLogger } from './store/logger'

const log = scopedLogger('window')

export const RENDERER_HTML = isDev
  ? join(appRoot, 'src/renderer/index.html')
  : join(appRoot, 'out/renderer/index.html')

export const PRELOAD = join(appRoot, 'out/preload/index.cjs')

const WORKBENCH_DEFAULT = { width: 1280, height: 800 }
const WORKBENCH_MIN = { width: 980, height: 620 }
const FOCUS_SMALL = { width: 400, height: 220 }

/** 安全基线：共用 webPreferences */
function baseWebPreferences(): Electron.WebPreferences {
  return {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false
  }
}

export class WindowManager {
  private main: BrowserWindow | null = null
  private settingsWindow: BrowserWindow | null = null
  /** 专注窗口是否处于全屏 */
  private fullScreen = false
  /** 关窗时是否真的退出 */
  private allowClose = false

  getMain(): BrowserWindow | null {
    return this.main
  }

  isFullScreen(): boolean {
    return this.fullScreen
  }

  setAllowClose(v: boolean): void {
    this.allowClose = v
  }

  // ============================================================
  //  创建
  // ============================================================

  createMain(settings: Settings, theme: EffectiveTheme, mode: WindowMode): BrowserWindow {
    const chrome = windowChrome(theme)

    const win = new BrowserWindow({
      width: WORKBENCH_DEFAULT.width,
      height: WORKBENCH_DEFAULT.height,
      minWidth: WORKBENCH_MIN.width,
      minHeight: WORKBENCH_MIN.height,
      show: false,
      title: 'FocusOS',
      backgroundColor: windowBackground(theme),
      titleBarStyle: chrome.titleBarStyle,
      ...(chrome.titleBarOverlay ? { titleBarOverlay: chrome.titleBarOverlay } : {}),
      ...(chrome.vibrancy ? { vibrancy: chrome.vibrancy, visualEffectState: 'followWindow' } : {}),
      ...(chrome.backgroundMaterial
        ? { backgroundMaterial: chrome.backgroundMaterial }
        : {}),
      icon: undefined,
      webPreferences: baseWebPreferences()
    })

    this.applyChromeToWindow(win, theme)
    this.restoreBounds(win, settings)

    win.on('ready-to-show', () => {
      win.show()
      if (settings.lastFullscreen) {
        win.setFullScreen(true)
        this.fullScreen = true
      }
    })

    win.on('close', (e) => {
      // 正在计时/关闭窗口时按设置走「最小化到托盘」或真正退出
      if (this.allowClose) return
      if (settings.closeToTray) {
        e.preventDefault()
        win.hide()
        log.info('窗口已隐藏到托盘')
      }
    })

    win.on('closed', () => {
      this.main = null
      this.fullScreen = false
    })

    win.on('enter-full-screen', () => {
      this.fullScreen = true
      this.sendToRenderer('window:fullscreen-changed', true)
    })

    win.on('leave-full-screen', () => {
      this.fullScreen = false
      this.sendToRenderer('window:fullscreen-changed', false)
    })

    // 记住尺寸与位置
    const saveBounds = () => {
      if (win.isDestroyed()) return
      const b = win.getNormalBounds()
      settings.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height }
    }
    win.on('resized', saveBounds)
    win.on('moved', saveBounds)

    void this.loadRenderer(win, mode)
    this.main = win
    return win
  }

  /** 设置窗口：独立窗口，复用同一渲染层（路由到设置视图） */
  createSettingsWindow(theme: EffectiveTheme): BrowserWindow {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus()
      return this.settingsWindow
    }
    const chrome = windowChrome(theme)
    const win = new BrowserWindow({
      width: 880,
      height: 640,
      minWidth: 720,
      minHeight: 520,
      show: false,
      title: 'FocusOS 设置',
      backgroundColor: windowBackground(theme),
      titleBarStyle: chrome.titleBarStyle,
      ...(chrome.titleBarOverlay ? { titleBarOverlay: chrome.titleBarOverlay } : {}),
      ...(chrome.vibrancy ? { vibrancy: chrome.vibrancy } : {}),
      webPreferences: { ...baseWebPreferences(), nodeIntegration: false }
    })
    this.applyChromeToWindow(win, theme)
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.settingsWindow = null
    })
    void this.loadRenderer(win, 'settings', 'settingsWindow')
    this.settingsWindow = win
    return win
  }

  private async loadRenderer(
    win: BrowserWindow,
    mode: WindowMode,
    queryKey: 'mainWindow' | 'settingsWindow' = 'mainWindow'
  ): Promise<void> {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (isDev && devUrl) {
      const url = new URL(devUrl)
      url.searchParams.set('mode', mode)
      url.searchParams.set('for', queryKey)
      await win.loadURL(url.toString())
    } else {
      await win.loadFile(RENDERER_HTML, {
        query: { mode, for: queryKey }
      })
    }
  }

  private restoreBounds(win: BrowserWindow, settings: Settings): void {
    const b = settings.windowBounds
    if (!b || typeof b.width !== 'number') return
    // 只在位置仍可见时恢复，避免窗口跑到不存在的显示器上
    if (typeof b.x === 'number' && typeof b.y === 'number') {
      const displays = screen.getAllDisplays()
      const visible = displays.some((d) => {
        const area = d.workArea
        return (
          b.x! >= area.x - 50 &&
          b.y! >= area.y - 50 &&
          b.x! <= area.x + area.width - 50 &&
          b.y! <= area.y + area.height - 50
        )
      })
      if (visible) {
        win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
        return
      }
    }
    win.setSize(Math.max(WORKBENCH_MIN.width, b.width), Math.max(WORKBENCH_MIN.height, b.height))
  }

  /**
   * 主题切换时同步窗口外观。
   * ⭐ Windows 还必须同步 titleBarOverlay.symbolColor，
   *   否则 overlay 的最小化/关闭图标会与新背景撞色。
   */
  applyChromeToWindow(win: BrowserWindow, theme: EffectiveTheme): void {
    if (win.isDestroyed()) return
    const chrome = windowChrome(theme)
    const bg = windowBackground(theme)
    try {
      if (win.webContents.getURL().startsWith('http')) {
        // dev 下 backgroundColor 改动会触发重载，改用 setBackgroundColor
      }
      win.setBackgroundColor(bg)
    } catch {
      // 忽略
    }
    if (chrome.titleBarOverlay && typeof win.setTitleBarOverlay === 'function') {
      try {
        win.setTitleBarOverlay(chrome.titleBarOverlay)
      } catch (err) {
        log.warn('设置 titleBarOverlay 失败', err)
      }
    }
  }

  // ============================================================
  //  窗口操作
  // ============================================================

  private sendToRenderer(channel: string, payload?: unknown): void {
    if (this.main && !this.main.isDestroyed()) {
      this.main.webContents.send(channel, payload)
    }
  }

  showMain(): void {
    if (!this.main || this.main.isDestroyed()) return
    if (this.main.isMinimized()) this.main.restore()
    this.main.show()
    this.main.focus()
  }

  minimize(): void {
    this.main?.minimize()
  }

  /** 专注全屏 / 小窗来回切换 */
  async toggleFullscreen(): Promise<boolean> {
    if (!this.main || this.main.isDestroyed()) return this.fullScreen
    // ⚠️ 以窗口的**真实**全屏状态为准，而不是缓存的 this.fullScreen。
    //    macOS 上用户可能用绿灯按钮 / ⌃⌘F 自行进出全屏，
    //    缓存值在动画期间可能与实际不一致，一旦失真，
    //    按 Esc / F 就会「想退出却进不去」——正是用户反馈过的现象。
    const next = !this.main.isFullScreen()
    this.main.setFullScreen(next)
    this.fullScreen = next
    // 尺寸切换后同步给渲染层，避免小窗仍按大窗布局渲染
    this.sendToRenderer('window:fullscreen-changed', next)
    return next
  }

  /** 进入小窗（专注态）：400×220 固定、不可缩放 */
  enterFocusWindow(): void {
    if (!this.main || this.main.isDestroyed()) return
    this.main.setFullScreen(false)
    this.fullScreen = false
    this.main.setResizable(false)
    this.main.setMinimumSize(FOCUS_SMALL.width, FOCUS_SMALL.height)
    this.main.setMaximumSize(FOCUS_SMALL.width, FOCUS_SMALL.height)
    this.main.setSize(FOCUS_SMALL.width, FOCUS_SMALL.height, false)
    this.main.center()
    this.sendToRenderer('window:fullscreen-changed', false)
    this.sendToRenderer('window:mode', 'focusWindow')
  }

  /** 回到工作台：1280×800，可缩放 */
  enterWorkbench(): void {
    if (!this.main || this.main.isDestroyed()) return
    this.main.setFullScreen(false)
    this.fullScreen = false
    this.main.setResizable(true)
    this.main.setMinimumSize(WORKBENCH_MIN.width, WORKBENCH_MIN.height)
    this.main.setMaximumSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    const b = this.main.getNormalBounds()
    const width = Math.max(WORKBENCH_DEFAULT.width, b.width)
    const height = Math.max(WORKBENCH_DEFAULT.height, b.height)
    this.main.setSize(width, height, true)
    this.sendToRenderer('window:fullscreen-changed', false)
    this.sendToRenderer('window:mode', 'workbench')
  }

  /** 主题管理器调用的安全封装：窗口可能尚未创建或已销毁 */
  applyChromeToWindowSafe(theme: EffectiveTheme, bg: string): void {
    const targets: BrowserWindow[] = []
    if (this.main && !this.main.isDestroyed()) targets.push(this.main)
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) targets.push(this.settingsWindow)
    for (const w of targets) this.applyChromeToWindow(w, theme)
    void bg
  }

  openExternalUrl(url: string): void {
    void shell.openExternal(url)
  }

  quit(): void {
    this.allowClose = true
    if (this.main && !this.main.isDestroyed()) this.main.destroy()
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) this.settingsWindow.destroy()
  }

  broadcast(channel: string, payload?: unknown): void {
    const targets: BrowserWindow[] = []
    if (this.main && !this.main.isDestroyed()) targets.push(this.main)
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) targets.push(this.settingsWindow)
    for (const w of targets) w.webContents.send(channel, payload)
  }
}

export const windows = new WindowManager()
export { defaultCloseToTray }
