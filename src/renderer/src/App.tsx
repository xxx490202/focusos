// ============================================================
//  App.tsx — 应用根组件
// ============================================================
//  工作台布局：左侧 220px 侧栏 + 右侧内容区
// ============================================================
import { useEffect, useState } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { FocusView } from './components/timer/FocusView'
import { TaskModal } from './components/common/TaskModal'
import {
  Onboarding, ShortcutPanel, Toasts, TaskContextMenu, ScheduleContextMenu,
  BackgroundContextMenu, ConfirmDialog, IdleDialog
} from './components/common/Overlays'
import { DayView } from './views/DayView'
import { WeekView } from './views/WeekView'
import { InboxView } from './views/InboxView'
import { InsightsView } from './views/InsightsView'
import { SettingsView } from './views/SettingsView'
import { useDataStore } from './stores/useDataStore'
import { useUIStore } from './stores/useUIStore'
import { useThemeStore } from './stores/useThemeStore'
import { useHotkeys } from './hooks/useHotkeys'
import { initLang } from './i18n'
import { mediaUrl } from '@shared/media'
import styles from './App.module.css'

export function App() {
  const [booted, setBooted] = useState(false)
  const ready = useDataStore((s) => s.ready)
  const platformInfo = useDataStore((s) => s.platformInfo)
  const soundUrl = useDataStore((s) => s.soundUrl)

  const view = useUIStore((s) => s.view)
  const windowMode = useUIStore((s) => s.windowMode)
  const setOnboarding = useUIStore((s) => s.setOnboarding)
  /*
   * 左栏收起状态。
   * ⭐ 收起时侧栏宽度归零 → 内容区（背景图）铺满整个窗口，
   *    但「展开左栏」按钮仍浮在原坐标上，压在内容区左上角。
   *    这里把状态挂到根节点，供 global.css 派生 --hdr-inset，
   *    让各页面顶栏给这颗按钮让位（见 global.css 的同名规则）。
   */
  const sidebarCollapsed = useDataStore((s) => s.settings.sidebarCollapsed)

  const setAll = useDataStore((s) => s.setAll)
  const setBackgrounds = useDataStore((s) => s.setBackgrounds)
  const applyTheme = useThemeStore((s) => s.apply)
  const setEffective = useThemeStore((s) => s.setEffective)
  const effective = useThemeStore((s) => s.effective)

  useHotkeys()

  // ---------------- 启动引导 ----------------
  useEffect(() => {
    if (booted) return
    let cancelled = false

    void window.api.bootstrap().then((r) => {
      if (cancelled) return
      if (!r.ok) return
      const d = r.data
      setAll({
        tasks: d.tasks,
        planBlocks: d.planBlocks,
        sessions: d.sessions,
        dailyStats: d.dailyStats,
        habits: d.habits,
        settings: d.settings,
        platformInfo: d.platformInfo,
        backgrounds: d.backgrounds,
        soundUrl: d.soundUrl,
        legacyMigrated: d.legacyMigrated
      })
      setEffective(d.effectiveTheme)

      // 平台信息注入 CSS 变量，让 CSS 无需感知平台
      document.documentElement.dataset.platform = d.platformInfo.os
      // 红绿灯占位：macOS 44px，Windows 0
      document.documentElement.style.setProperty(
        '--traffic-pad',
        `${d.platformInfo.chrome.trafficLightPad}px`
      )
      /*
       * 红绿灯的几何（右侧边缘 / 垂直中心）也一并注入。
       * 「收起左栏」按钮必须**永远**贴在红绿灯右侧的同一坐标上，
       * 而它在展开/收起两态都要定位在那个位置 —— CSS 里不能写死 65px，
       * 否则 Windows（无红绿灯）会算错。
       */
      document.documentElement.style.setProperty(
        '--traffic-right',
        `${d.platformInfo.chrome.trafficLightRight}px`
      )
      document.documentElement.style.setProperty(
        '--traffic-center-y',
        `${d.platformInfo.chrome.trafficLightCenterY}px`
      )
      // 字体栈由 platform.ts 提供，不在 CSS 里硬编码
      document.documentElement.style.fontFamily = d.platformInfo.fontStack

      if (!d.settings.onboardingDone) setOnboarding(true)
      setBooted(true)
    })

    return () => {
      cancelled = true
    }
  }, [booted, setAll, setEffective, setOnboarding])

  // ---------------- 主进程推送 ----------------
  useEffect(() => {
    if (!booted) return
    // 主题变化
    const offTheme = window.api.on('theme:system-changed', (p) => {
      setEffective(p as 'light' | 'dark')
    })
    // 托盘命令
    const offTray = window.api.on('tray:command', (p) => {
      const cmd = (p as { command: string }).command
      const ui = useUIStore.getState()
      switch (cmd) {
        case 'start':
          void window.api.timer.start()
          break
        case 'pause':
          void window.api.timer.pause()
          break
        case 'reset':
          void window.api.timer.reset()
          break
        case 'skip':
          void window.api.timer.skip()
          break
        case 'break':
          void window.api.timer.break()
          break
        case 'new-task':
          ui.setWindowMode('workbench')
          ui.openTaskModal()
          break
        case 'show':
          ui.setWindowMode('workbench')
          break
      }
    })
    // 窗口模式切换
    const offMode = window.api.on('window:mode', (p) => {
      const m = p as string
      if (m === 'workbench') useUIStore.getState().setWindowMode('workbench')
      if (m === 'focusWindow') useUIStore.getState().setWindowMode('focusWindow')
    })
    const offFs = window.api.on('window:fullscreen-changed', (p) => {
      const fs = Boolean(p)
      useUIStore.getState().setWindowMode(fs ? 'workbench' : useUIStore.getState().windowMode)
    })
    // 提示音：两平台统一用自带 chime.wav
    const offSound = window.api.on('sound:chime', (p) => {
      const { url, volume } = p as { url: string; volume: number }
      const src = mediaUrl(url || soundUrl)
      if (!src) return
      const audio = new Audio(src)
      audio.volume = volume
      void audio.play().catch(() => undefined)
    })
    /*
     * 数据变化通知（主进程在任何改动持久化数据的操作后广播，
     * 含设置窗口里的改动）。
     *
     * ⚠️ 做 120ms 尾随防抖：设置页的滑块是 onChange 连续触发的，
     *    每次都会写盘并广播一次。不防抖的话拖一次滑块就会打出几十个
     *    bootstrap 往返（每个都要读一次背景图目录），白白卡顿。
     */
    let reloadTimer: number | undefined
    const offData = window.api.on('data:changed', () => {
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer)
      reloadTimer = window.setTimeout(() => {
        reloadTimer = undefined
        void useDataStore.getState().reload()
      }, 120)
    })

    /*
     * ⭐ 阶段结束必须刷新数据。
     *    主进程在阶段自然走完时会写入 session、累加 dailyStats 的番茄数、
     *    并把任务上的 completedPomodoros +1 —— 这些都不在 TimerState 里，
     *    光靠 timer:tick 是拿不到的。
     *    （此前 timer:phase 无人订阅，导致一个番茄做完后
     *      今日进度点阵与任务卡上的 🍅 计数不更新。）
     */
    const offPhase = window.api.on('timer:phase', () => {
      void useDataStore.getState().reload()
    })

    /*
     * 空闲回处理。
     * ⚠️ 必须先问一次计时器状态再弹窗：主进程不知道计时器在不在跑，
     *    计时器停着的时候问「保不保留这段时间」是没有意义的，
     *    只会在用户离开回来的瞬间白弹一次。
     */
    const offIdle = window.api.on('push:idle', (p) => {
      const { seconds } = p as { seconds: number }
      if (!seconds || seconds <= 0) return
      void window.api.timer.get().then((r) => {
        if (!r.ok) return
        if (r.data.status === 'IDLE') return
        useUIStore.getState().showIdleDialog(seconds)
      })
    })

    return () => {
      offTheme()
      offTray()
      offMode()
      offFs()
      offSound()
      offData()
      offPhase()
      offIdle()
      if (reloadTimer !== undefined) window.clearTimeout(reloadTimer)
    }
  }, [booted, setEffective, soundUrl])

  // 主题应用
  useEffect(() => {
    applyTheme()
  }, [effective, applyTheme])

  /*
   * 语言同步。
   * ⚠️ 在 App 里单向订阅 settings.language → i18n store，而不是让
   *    设置页各自去改 i18n —— 这样「主窗口改」和「设置窗口改」两条
   *    路径都只需要改数据，界面语言由同一条链路推导出来。
   */
  const language = useDataStore((s) => s.settings.language)
  useEffect(() => {
    initLang(language)
  }, [language])

  // ---------------- 渲染 ----------------
  if (!booted || !ready) {
    return (
      <div className={styles.boot} data-theme={effective}>
        <span className={styles.bootMark} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    )
  }

  const focused = windowMode === 'focusWindow' && (view === 'focus' || view === 'day')

  return (
    <div
      className={styles.root}
      data-platform={platformInfo?.os}
      data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      /* 专注窗口没有侧栏 —— 让 Toast 之类的浮层把内容区当成整个窗口来居中 */
      data-focus={focused ? 'true' : 'false'}
    >
      {focused ? (
        <FocusView compact={windowMode === 'focusWindow'} />
      ) : (
        <div className={styles.workbench}>
          {/* macOS 给红绿灯让位；Windows 走 overlay 无需留白 */}
          <Sidebar />
          <main className={styles.content}>
            {view === 'focus' && <FocusView compact={false} />}
            {view === 'day' && <DayView />}
            {view === 'week' && <WeekView />}
            {view === 'inbox' && <InboxView />}
            {view === 'insights' && <InsightsView />}
            {view === 'settings' && <SettingsView />}
          </main>
        </div>
      )}

      <TaskModal />
      <Onboarding />
      <ShortcutPanel />
      {/* 任务卡 / 日程事件 / 背景图右键菜单 + 破坏性操作的二次确认 */}
      <TaskContextMenu />
      <ScheduleContextMenu />
      <BackgroundContextMenu />
      <ConfirmDialog />
      <IdleDialog />
      <Toasts />

      {/* 数据变更后刷新背景列表（导入图片时） */}
      <BackgroundRefresher setBackgrounds={setBackgrounds} />
    </div>
  )
}

/** 监听设置页导入背景图后刷新列表 */
function BackgroundRefresher({
  setBackgrounds
}: {
  setBackgrounds: (b: string[]) => void
}) {
  const backgrounds = useDataStore((s) => s.backgrounds)
  const settings = useDataStore((s) => s.settings)

  useEffect(() => {
    if (!settings.background.enabled) return
    void window.api.sys.backgrounds().then((r) => {
      if (r.ok && r.data.length !== backgrounds.length) setBackgrounds(r.data)
    })
  }, [settings.background.enabled, backgrounds.length, setBackgrounds])

  return null
}
