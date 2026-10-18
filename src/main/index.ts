// ============================================================
//  index.ts — app 生命周期、单实例锁、开机自启、协议注册
// ============================================================
//  ⭐ 本文件不含平台分支，平台差异走 platform.ts。
// ============================================================
import { app, globalShortcut, powerMonitor, shell, Menu } from 'electron'
import { windows } from './window'
import { tray } from './tray'
import { themeManager } from './theme'
import { registerIpc } from './ipc/index'
import { idleWatcher } from './idle-watcher'
import { controller } from './app-controller'
import { repository } from './store/repository'
import { setPowerSource, setShell, setOsRelease, suppressDefaultMenu } from '@shared/platform'
import { registerMediaScheme, installMediaProtocol } from './media-protocol'
import os from 'node:os'
import { scopedLogger } from './store/logger'

const log = scopedLogger('main')

// ⭐ 必须在 app ready 之前声明自定义协议（模块加载期，早于 main()）
registerMediaScheme()

// ⭐ 平台能力注入：让 shared/platform.ts 不必 import electron
setOsRelease(os.release())
setShell(shell)

// ============================================================
//  单实例锁
// ============================================================
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windows.showMain()
  })

  void main()
}

async function main(): Promise<void> {
  // ⭐ Windows 上必须先设置 appId，否则通知不显示应用名
  app.setAppUserModelId('com.focusos.app')

  /*
   * ⭐ Windows 撤掉默认菜单栏（文件/编辑/视图/窗口/帮助）。
   *   它是原生绘制的，会压在自绘界面最上层、CSS 挪不动 ——
   *   表现为「关于(A)」这类菜单项盖在界面左上角（用户实测反馈）。
   *   macOS 不走这条：那里的菜单栏在屏幕顶部、不在窗口内，且是预期入口。
   */
  if (suppressDefaultMenu()) {
    Menu.setApplicationMenu(null)
  }

  await app.whenReady()

  // 渲染层加载背景图 / 提示音统一走自定义协议（dev 下 file:// 会被拦截）
  installMediaProtocol()

  // 注入电源监控（mac: suspend/resume；win: lock-screen/unlock-screen）
  setPowerSource(powerMonitor)
  controller.engine.attachPowerEvents()

  const data = repository.read()
  // ⭐ 关窗默认行为已由 defaults.ts 调platform.defaultCloseToTray() 按平台决定，
  //    此处无需再判断 undefined。

  themeManager.remember(data.settings.theme, data.settings)
  const effective = themeManager.apply(data.settings.theme, data.settings)
  themeManager.attachSystemListener()
  themeManager.onChange((theme) => tray.onThemeChanged(theme))

  registerIpc()

  // 按用户决定：启动直接进工作台（1280×800）
  windows.createMain(controller.getSettings(), effective, 'workbench')
  windows.setAllowClose(false)

  tray.create()
  tray.update(controller.engine.snapshot())

  // 空闲检测：按设置启动（关着就什么都不做）
  idleWatcher.configure(data.settings.idle)

  registerShortcuts()

  app.on('activate', () => {
    if (BrowserWindowAllClosed()) return
    windows.showMain()
  })

  app.on('window-all-closed', () => {
    // 关窗默认行为由 close 事件处理；这里不直接退出，交由托盘/设置决定
  })

  /*
   * ⭐ 任何**应用级退出**都必须放行窗口 close —— 否则会被「关窗进托盘」
   *    的拦截逻辑吞掉，表现为「右键 Dock 图标 → 退出」毫无反应：
   *    · Dock 菜单的「退出」和 Cmd+Q 走的是 app.quit()
   *      → 触发 before-quit → 这里把 allowClose 打开，close 才不再 preventDefault；
   *    · 托盘菜单的「退出 FocusOS」本来就会先置位，这里是同一道保险。
   *    窗口右上角的 ✕ 不走这条路径（before-quit 不触发），仍按设置缩进托盘。
   */
  app.on('before-quit', () => {
    windows.setAllowClose(true)
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    repository.flushNow()
    repository.cleanupTmp()
    controller.engine.dispose()
    tray.destroy()
  })
}

function BrowserWindowAllClosed(): boolean {
  return !windows.getMain()
}

// ============================================================
//  全局快捷键
// ============================================================
//  ⭐ 底层一律用 CmdOrCtrl 前缀；冲突时降级为窗口内快捷键。
// ============================================================
interface ShortcutDef {
  accelerator: string
  action: () => void
}

function registerShortcuts(): void {
  const defs: ShortcutDef[] = [
    {
      accelerator: 'CmdOrCtrl+Shift+Space',
      action: () => {
        const s = controller.engine.snapshot()
        if (s.status === 'RUNNING') controller.engine.pause()
        else controller.engine.start()
      }
    },
    { accelerator: 'CmdOrCtrl+Shift+F', action: () => void windows.toggleFullscreen() },
    {
      accelerator: 'CmdOrCtrl+Shift+N',
      action: () => windows.broadcast('tray:command', 'new-task')
    },
    {
      accelerator: 'CmdOrCtrl+Shift+D',
      action: () => {
        windows.showMain()
        windows.broadcast('window:mode', 'workbench')
        windows.broadcast('tray:command', 'show')
      }
    }
  ]

  const failed: string[] = []
  for (const def of defs) {
    try {
      const ok = globalShortcut.register(def.accelerator, def.action)
      if (!ok) failed.push(def.accelerator)
    } catch {
      failed.push(def.accelerator)
    }
  }

  if (failed.length > 0) {
    log.warn(`以下全局快捷键注册失败（已降级为窗口内快捷键）: ${failed.join(', ')}`)
    windows.broadcast('shortcut:failed', failed)
  } else {
    log.info('全局快捷键注册成功')
  }
}

// ============================================================
//  托盘命令分发
// ============================================================
app.on('browser-window-created', (_e, win) => {
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
})
