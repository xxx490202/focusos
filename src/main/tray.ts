// ============================================================
//  tray.ts — 菜单栏 / 托盘
// ============================================================
//  ⭐ 差异全部走 platform.ts 的 trayIconAsset()：
//     macOS 用 Template 变体 + setTemplateImage(true)（系统自动反色）
//     Windows 用彩色图标，深浅两套跟随主题切换
// ============================================================
import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import {
  trayIconAsset,
  trayIconPointSize,
  trayTitleBudget,
  trayNoun,
  defaultCloseToTray
} from '@shared/platform'
import type { EffectiveTheme, TimerState } from '@shared/types'
import { translate } from '@shared/i18n'
import { formatClock } from '@shared/schedule'
import { buildDir } from './paths'
import { repository } from './store/repository'
import { windows } from './window'
import { scopedLogger } from './store/logger'
import type { TrayCommandPayload } from '@shared/ipc-contract'

const log = scopedLogger('tray')

/** Windows 上 3 秒刷新更耗电，放宽到 5 秒 */
const REFRESH_MS = trayTitleBudget() === 'full' ? 3000 : 5000

/**
 * 加载托盘图标并压回平台标准渲染尺寸。
 *
 * ⚠️ resize 必须在 setTemplateImage 之前：
 *    nativeImage.resize() 返回的是新对象，Template 标记不会自动继承。
 */
function loadTrayImage(asset: { file: string; isTemplate: boolean }): Electron.NativeImage {
  // ⚠️ 绝对路径在主进程组装；打包态 build/ 由 electron-builder 的
  //    extraResources 映射到 Resources/build，与 buildDir() 对齐
  const abs = join(buildDir(), asset.file)
  let image = nativeImage.createFromPath(abs)
  if (image.isEmpty()) {
    log.warn('托盘图标加载失败，回退空图标', abs)
    return nativeImage.createEmpty()
  }
  const size = trayIconPointSize()
  if (image.getSize().width !== size || image.getSize().height !== size) {
    image = image.resize({ width: size, height: size, quality: 'best' })
  }
  if (asset.isTemplate) image.setTemplateImage(true)
  return image
}

class TrayManager {
  private tray: Tray | null = null
  private timer: NodeJS.Timeout | null = null
  private lastTimer: TimerState | null = null
  private theme: EffectiveTheme = 'dark'

  create(): void {
    if (this.tray) return
    const asset = trayIconAsset(this.theme)
    // ⭐ macOS 走 Template（系统自动反色）；Windows 走彩色双套
    const image = loadTrayImage(asset)

    this.tray = new Tray(image)
    this.tray.setToolTip('FocusOS')
    this.refreshMenu(null)

    this.tray.on('click', () => {
      windows.showMain()
    })
    this.tray.on('double-click', () => {
      windows.showMain()
    })

    this.timer = setInterval(() => this.refreshMenu(this.lastTimer), REFRESH_MS)
    log.info(`${trayNoun()}图标已创建`)
  }

  /** 主题切换时换图标（Windows 需要换套） */
  onThemeChanged(theme: EffectiveTheme): void {
    this.theme = theme
    if (!this.tray) return
    const asset = trayIconAsset(theme)
    const image = loadTrayImage(asset)
    if (image.isEmpty()) return
    this.tray.setImage(image)
  }

  /** 计时状态变化时更新标题与菜单 */
  update(timer: TimerState): void {
    this.lastTimer = timer
    if (!this.tray) return

    /*
     * 标题只显示剩余时间（用户要求去掉 🍅 前缀，菜单栏保持干净）。
     * ⚠️ Windows 任务栏空间不足时 setTitle 过长会被省略
     */
    if (trayTitleBudget() === 'minutes-only') {
      const mins = Math.ceil(timer.remainingSeconds / 60)
      this.tray.setTitle(`${mins}m`)
    } else {
      this.tray.setTitle(formatClock(timer.remainingSeconds))
    }
    this.refreshMenu(timer)
  }

  private refreshMenu(timer: TimerState | null): void {
    if (!this.tray) return
    const running = timer?.status === 'RUNNING'
    const send = (command: TrayCommandPayload['command']): void => {
      windows.broadcast('tray:command', { command })
    }

    /*
     * 托盘菜单也要跟随界面语言。
     * ⚠️ 主进程不订阅渲染层的语言状态，直接读设置 ——
     *    菜单每 3~5 秒（见 REFRESH_MS）由计时刷新重建一次，
     *    因此用户切换语言后最多几秒这里就会跟上，不需要额外的推送通道。
     */
    const lang = repository.read().settings.language
    const tr = (zh: string): string => translate(zh, lang)

    const menu = Menu.buildFromTemplate([
      {
        label: running ? `⏸ ${tr('暂停')}` : `▶ ${tr('开始')}`,
        click: () => send(running ? 'pause' : 'start')
      },
      { label: `⟳ ${tr('重置')}`, click: () => send('reset') },
      { label: `☕ ${tr('立即休息')}`, click: () => send('break') },
      { label: `⏭ ${tr('跳过阶段')}`, click: () => send('skip') },
      { type: 'separator' },
      { label: tr('显示窗口'), click: () => windows.showMain() },
      { label: tr('新建任务'), click: () => send('new-task') },
      { type: 'separator' },
      {
        label: tr('退出 FocusOS'),
        click: () => {
          windows.setAllowClose(true)
          app.quit()
        }
      }
    ])
    this.tray.setContextMenu(menu)
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.tray?.destroy()
    this.tray = null
  }
}

export const tray = new TrayManager()
export { defaultCloseToTray }
