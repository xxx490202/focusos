// ============================================================
//  app-controller.ts — 主进程业务编排
// ============================================================
//  把计时引擎、数据层、提示音、通知、统计串起来。
// ============================================================
import { Notification, shell, app } from 'electron'
import { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { TimerEngine, type TimerEvents } from './timer/timer-engine'
import { repository } from './store/repository'
import { scopedLogger } from './store/logger'
import {
  recordSession,
  listTasks,
  todayFocusCount,
  todayKey,
  save
} from './store/task-service'
import { windows } from "./window"
import { tray } from './tray'
import { themeManager } from './theme'
import { soundUrl, listBackgrounds, toFileUrl, userBackgroundsDir, appBuildNumber } from './paths'
import { keyLabel, platformKey, platformLabel, supportsTitleBarOverlayOptions, supportsVibrancyOptions, supportsMaterialOptions, trayNoun, sleepNoun, defaultCloseToTray, windowChrome, fontStack } from '@shared/platform'
import { isInDnd, dateKey } from '@shared/schedule'
import type {
  TimerState,
  Settings,
  PlanPreviewBlock,
  PlanBlock,
  EffectiveTheme
} from '@shared/types'
import type { BootstrapPayload, PlanPreviewPayload } from '@shared/ipc-contract'
import { generatePlan, type Occupied } from './scheduler/plan-generator'
import { blocksForRange } from './store/task-service'

const log = scopedLogger('controller')

export class AppController {
  readonly engine: TimerEngine
  /** 预览态计划块（未确认前不落盘） */
  private planPreview: PlanPreviewBlock[] = []

  constructor() {
    const data = repository.read()
    const s = data.settings

    const events: TimerEvents = {
      onTick: (state) => {
        windows.broadcast('timer:tick', state)
        tray.update(state)
      },
      onPhaseChange: (phase) => {
        windows.broadcast('timer:phase', phase)
      },
      onStateChange: (state) => {
        // 计时状态只在主进程持有，渲染层纯订阅；
        // 这里落盘以便窗口崩溃 / 重启后恢复
        this.persistTimer(state)
      },
      onPhaseComplete: (phase, endedAt) => {
        log.debug(`阶段完成 ${phase}`)
        void endedAt
      },
      onCatchUp: (phases, endedAt) => {
        log.info(`补响 ${phases.length} 个阶段`)
        for (let i = 0; i < phases.length; i++) this.chime()
        this.maybeNotify(`已补齐 ${phases.length} 个阶段`, endedAt)
      },
      onFocusCompleted: (info) => {
        recordSession({
          taskId: info.taskId ?? undefined,
          phase: 'focus',
          plannedSeconds: info.plannedSeconds,
          actualSeconds: info.actualSeconds,
          startedAt: info.startedAt,
          endedAt: info.endedAt,
          completed: true
        })
        this.chime()
        this.checkGoals(info.taskId, info.endedAt)
      }
    }

    this.engine = new TimerEngine(events, s.durations, {
      longBreakEvery: s.longBreakEvery,
      autoStartNextPhase: s.autoStartNextPhase,
      strictMode: s.strictMode,
      flowMode: s.focusMode === 'flowtime',
      flowtime: s.flowtime
    })

    // 恢复上次计时
    const snapshot = repository.read().settings as unknown as { lastTimer?: TimerState }
    if (snapshot?.lastTimer) {
      try {
        this.engine.restore(snapshot.lastTimer)
      } catch (err) {
        log.warn('恢复计时状态失败', err)
      }
    }
  }

  // ============================================================
  //  持久化计时状态
  // ============================================================

  private persistTimer(state: TimerState): void {
    const data = repository.read()
    // 计时快照单独挂 settings 上，避免污染正式字段
    ;(data.settings as unknown as { lastTimer?: TimerState }).lastTimer = state
    save(data)
  }

  // ============================================================
  //  提示音与通知
  // ============================================================

  /** ⭐ 两平台统一用自带 chime.wav，禁止依赖系统音 */
  chime(): void {
    const data = repository.read()
    if (!data.settings.soundEnabled) return
    const url = soundUrl()
    if (!url) return
    windows.broadcast('sound:chime', { url, volume: data.settings.soundVolume })
  }

  private inDnd(ts: number): boolean {
    const s = repository.read().settings
    if (!s.dndEnabled) return false
    const d = new Date(ts)
    return isInDnd(d.getHours() * 60 + d.getMinutes(), s.dnd.from, s.dnd.to)
  }

  /** 勿扰时段内不弹系统通知，专注计时不受影响 */
  private maybeNotify(body: string, ts: number): void {
    const s = repository.read().settings
    if (!s.notifications.phaseDone) return
    if (this.inDnd(ts)) return
    if (!Notification.isSupported()) return
    // ⚠️ Windows 上首次通知前需确保已设置 appId，否则不显示应用名
    new Notification({
      title: 'FocusOS',
      body,
      icon: undefined,
      silent: true
    }).show()
  }

  private checkGoals(taskId: string | null, ts: number): void {
    const s = repository.read().settings
    const count = todayFocusCount()

    if (count >= s.dailyPomodoroLimit && s.notifications.dailyGoalReached) {
      this.maybeNotify(`今日 ${s.dailyPomodoroLimit} 个番茄已达成 🎉`, ts)
    }
    if (taskId) {
      const task = listTasks().find((t) => t.id === taskId)
      if (
        task &&
        task.estimatedPomodoros > 0 &&
        task.completedPomodoros >= task.estimatedPomodoros &&
        s.notifications.taskGoalReached
      ) {
        this.maybeNotify(`「${task.title}」番茄达标 ✓`, ts)
      }
    }
  }

  // ============================================================
  //  启动引导数据
  // ============================================================

  bootstrap(theme: EffectiveTheme): BootstrapPayload {
    const data = repository.read()
    return {
      tasks: data.tasks,
      planBlocks: data.planBlocks,
      sessions: data.sessions,
      dailyStats: data.dailyStats,
      habits: data.habits,
      settings: data.settings,
      timer: this.engine.snapshot(),
      effectiveTheme: theme,
      platformInfo: this.platformInfo(),
      backgrounds: this.visibleBackgrounds(),
      soundUrl: soundUrl(),
      legacyMigrated: repository.getLegacyMigrated()
    }
  }

  platformInfo(): BootstrapPayload['platformInfo'] {
    const chrome = windowChrome(themeManager.current_)
    return {
      os: platformKey(),
      platformLabel: platformLabel(),
      version: app.getVersion(),
      build: appBuildNumber(),
      electron: process.versions.electron ?? '',
      fontStack: fontStack(),
      keys: { mod: keyLabel('mod'), alt: keyLabel('alt'), shift: keyLabel('shift') },
      supportsTitleBarOverlayOptions: supportsTitleBarOverlayOptions(),
      supportsVibrancyOptions: supportsVibrancyOptions(),
      supportsMaterialOptions: supportsMaterialOptions(),
      trayNoun: trayNoun(),
      sleepNoun: sleepNoun(),
      defaultCloseToTray: defaultCloseToTray(),
      /*
       * ⚠️ 整体透传 windowChrome() 的结果，不要逐字段手抄。
       *    手抄过一次：给 WindowChrome 加了 trafficLightRight / CenterY 后
       *    这里漏了，渲染层拿不到红绿灯几何（「收起左栏」按钮会定位错误）。
       */
      chrome
    }
  }

  // ============================================================
  //  设置
  // ============================================================

  getSettings(): Settings {
    return repository.read().settings
  }

  patchSettings(patch: Partial<Settings>): Settings {
    const data = repository.read()
    data.settings = { ...data.settings, ...patch }
    save(data)
    // 立即生效，无需重启
    this.engine.configure({
      durations: data.settings.durations,
      longBreakEvery: data.settings.longBreakEvery,
      autoStartNextPhase: data.settings.autoStartNextPhase,
      strictMode: data.settings.strictMode,
      // 专注模式是「立即生效」的：切到心流后下一次按开始就是正计时
      flowMode: data.settings.focusMode === 'flowtime',
      flowtime: data.settings.flowtime
    })
    themeManager.remember(data.settings.theme, data.settings)
    return data.settings
  }

  // ============================================================
  //  计划生成（F6）
  // ============================================================

  generatePlanPreview(taskIds: string[], date: string, windowStart: string, windowEnd: string): PlanPreviewPayload {
    const data = repository.read()
    const tasks = data.tasks.filter((t) => taskIds.includes(t.id))

    // 已占用：任务块 + 已有计划块
    const occupied: Occupied = blocksForRange(date, date, data.settings).map((b) => ({
      date: b.date,
      startMin: b.startMin,
      endMin: b.endMin
    }))

    const result = generatePlan(
      { taskIds, date, windowStart, windowEnd },
      {
        tasks,
        occupied,
        settings: data.settings,
        todayFocusCount: todayFocusCount()
      }
    )
    this.planPreview = result.blocks
    return { blocks: result.blocks, skipped: result.skipped }
  }

  getPlanPreview(): PlanPreviewBlock[] {
    return this.planPreview
  }

  commitPlanPreview(date: string): PlanBlock[] {
    const data = repository.read()
    const created: PlanBlock[] = this.planPreview.map((b) => ({
      id: `plan_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      taskId: b.taskId,
      date,
      startTime: b.startTime,
      endTime: b.endTime,
      phase: b.phase,
      index: b.index,
      consumed: false,
      createdAt: Date.now()
    }))
    data.planBlocks.push(...created)
    save(data)
    this.planPreview = []
    return created
  }

  discardPlanPreview(): void {
    this.planPreview = []
  }

  // ============================================================
  //  数据导入导出
  // ============================================================

  exportData(): string {
    const data = repository.read()
    const d = new Date()
    const name = `focusos-export-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`
    const target = repository.exportPath(name)
    mkdirSync(userBackgroundsDir(), { recursive: true })
    writeFileSync(target, JSON.stringify(data, null, 2), 'utf8')
    shell.showItemInFolder(target)
    return name
  }

  /**
   * 导入：先用 zod 校验，失败给明确中文错误且不破坏现有数据。
   * ⚠️ 主进程无 dialog 时由渲染层选文件后传入路径。
   */
  importData(filePath: string): { ok: boolean; message: string } {
    try {
      if (!existsSync(filePath)) return { ok: false, message: '文件不存在' }
      const text = readFileSync(filePath, 'utf8')
      const parsed = repository.parseImport(text)
      repository.replace(parsed)
      this.engine.reset()
      return { ok: true, message: `已导入 ${parsed.tasks.length} 个任务` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导入失败'
      return { ok: false, message: msg }
    }
  }

  clearAllData(): void {
    repository.clear()
    this.engine.reset()
  }

  openDataDir(): void {
    void shell.openPath(app.getPath('userData'))
  }

  /** 复制用户选中的背景图进 userData */
  addBackground(srcPath: string): string {
    const dir = userBackgroundsDir()
    mkdirSync(dir, { recursive: true })
    const name = basename(srcPath)
    const target = join(dir, name)
    try {
      copyFileSync(srcPath, target)
      const url = toFileUrl(target)
      /*
       * ⭐ 重新导入一张「之前从列表里移除过」的图：同名文件 → 同一个 file:// URL，
       *    若不在这里放行，就会命中 hidden 名单被过滤掉 ——
       *    表现成「导入成功但列表里没有它」的灵异 bug。
       *    用户既然又导了一遍，意图很清楚：就是想看到它。
       */
      this.unhideBackground(url)
      return url
    } catch (err) {
      log.error('复制背景图失败', err)
      return ''
    }
  }

  /** 真正可用的背景图 = 磁盘上的 − 用户已从应用里移除的 */
  visibleBackgrounds(): string[] {
    const hidden = new Set(repository.read().settings.background.hidden)
    return listBackgrounds().filter((u) => !hidden.has(u))
  }

  /**
   * 删除背景图 = **只在应用里删，绝不动电脑上的文件**。
   *
   * ⭐ 语义（用户明确要求：点击删除只是在这个 app 里删，不是在整个电脑里删）：
   *    用户导入的背景图就是他电脑上的原图，点一下「删除」就把原图从硬盘
   *    抹掉太激进了。所以这里只把它记进 settings.background.hidden ——
   *    图从缩略图列表与轮播里消失，原图原样留在原处。
   *
   *    旧实现是「unlink → 系统废纸篓 → 兜底隐藏」三级降级：在受限环境里
   *    会走到第三级，弹出一句「文件受系统保护，未能删除」——
   *    用户看到这句只会困惑（他只是想从列表里去掉一张图）。
   *    现在整条磁盘写入路径直接删掉，从根上不会再出现那种提示。
   *
   * 顺带的好处：内置壁纸（在 resources 里，路径不在用户目录）同样可以删除，
   * 旧实现里「只允许删用户目录内文件」的限制也就不存在了。
   *
   * @returns 'removed' 已从应用删除 | 'failed' 持久化失败
   */
  removeBackground(fileUrl: string): 'removed' | 'failed' {
    try {
      const data = repository.read()
      const bg = data.settings.background
      repository.write({
        ...data,
        settings: {
          ...data.settings,
          background: {
            ...bg,
            // 重复删除同一张时不要往数组里塞重复项
            hidden: bg.hidden.includes(fileUrl) ? bg.hidden : [...bg.hidden, fileUrl],
            /*
             * 顺手从轮播顺序里摘掉：不摘的话 order 会越积越长，
             * 里面全是已删除的死条目（并随每次设置写盘一起变大）。
             */
            order: bg.order.filter((u) => u !== fileUrl)
          }
        }
      })
      return 'removed'
    } catch (err) {
      log.error('删除背景图失败', err)
      return 'failed'
    }
  }

  /**
   * 把一张图从已删除名单里放出来。
   *
   * ⭐ 唯一调用方是 addBackground：用户重新导入一张「之前删过」的图时，
   *    文件名相同 → file:// URL 也相同，若不放行就会命中 hidden 名单被过滤掉，
   *    表现成「导入成功但列表里没有它」的灵异 bug。
   *
   * @returns 是否成功落盘（本来就不在名单里也算成功）
   */
  private unhideBackground(fileUrl: string): boolean {
    try {
      const data = repository.read()
      const bg = data.settings.background
      if (!bg.hidden.includes(fileUrl)) return true
      repository.write({
        ...data,
        settings: {
          ...data.settings,
          background: { ...bg, hidden: bg.hidden.filter((u) => u !== fileUrl) }
        }
      })
      return true
    } catch (err) {
      log.warn('清理背景图删除记录失败', err)
      return false
    }
  }

  // ============================================================
  //  统计
  // ============================================================

  statRange(from: string, to: string): unknown {
    const data = repository.read()
    const sessions = data.sessions.filter((s) => {
      const d = dateKey(s.endedAt)
      return d >= from && d <= to
    })
    const focusDone = sessions.filter((s) => s.phase === 'focus' && s.completed)
    const totalSeconds = focusDone.reduce((a, s) => a + s.actualSeconds, 0)
    const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1)

    // 分类占比
    const byCategory = new Map<string, { seconds: number; count: number }>()
    for (const s of focusDone) {
      const task = data.tasks.find((t) => t.id === s.taskId)
      const cat = task?.category ?? 'other'
      const cur = byCategory.get(cat) ?? { seconds: 0, count: 0 }
      cur.seconds += s.actualSeconds
      cur.count += 1
      byCategory.set(cat, cur)
    }

    // 近 14 日
    const daily: { date: string; count: number; target: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(to)
      dt.setDate(dt.getDate() - i)
      const key = dateKey(dt.getTime())
      const stat = data.dailyStats.find((s) => s.date === key)
      daily.push({ date: key, count: stat?.focusCount ?? 0, target: data.settings.dailyPomodoroLimit })
    }

    // 7×24 时段热力
    const heatmap: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
    for (const s of focusDone) {
      const d = new Date(s.startedAt)
      heatmap[d.getDay()][d.getHours()] += s.actualSeconds / 60
    }

    // 节律
    const dayparts = { morning: 0, afternoon: 0, evening: 0 }
    for (const s of focusDone) {
      const h = new Date(s.startedAt).getHours()
      if (h < 12) dayparts.morning += 1
      else if (h < 18) dayparts.afternoon += 1
      else dayparts.evening += 1
    }

    // 时间流向：24 个时段 → 各类别秒数
    const flow: { category: string; seconds: number }[][] = Array.from({ length: 24 }, () => [])
    for (const s of focusDone) {
      const d = new Date(s.startedAt)
      const task = data.tasks.find((t) => t.id === s.taskId)
      const cat = task?.category ?? 'other'
      const col = flow[d.getHours()]
      const cell = col.find((c) => c.category === cat)
      if (cell) cell.seconds += s.actualSeconds
      else col.push({ category: cat, seconds: s.actualSeconds })
    }

    // 近一年
    const year: { date: string; count: number }[] = data.dailyStats.map((s) => ({
      date: s.date,
      count: s.focusCount
    }))

    return {
      focusCount: focusDone.length,
      focusSeconds: totalSeconds,
      tasksDone: data.dailyStats
        .filter((s) => s.date >= from && s.date <= to)
        .reduce((a, s) => a + s.tasksDone, 0),
      totalSessions: sessions.length,
      completedSessions: focusDone.length,
      completionRate: sessions.length === 0 ? 0 : focusDone.length / sessions.length,
      avgFocusSecondsPerDay: totalSeconds / days,
      daily,
      byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })),
      heatmap,
      dayparts: [
        { part: 'morning' as const, count: dayparts.morning },
        { part: 'afternoon' as const, count: dayparts.afternoon },
        { part: 'evening' as const, count: dayparts.evening }
      ],
      flow,
      year
    }
  }

  taskTop(from: string, to: string, limit = 10): unknown[] {
    const data = repository.read()
    const map = new Map<string, { seconds: number; count: number; title: string }>()
    for (const s of data.sessions) {
      if (s.phase !== 'focus' || !s.completed) continue
      const d = dateKey(s.endedAt)
      if (d < from || d > to) continue
      if (!s.taskId) continue
      const task = data.tasks.find((t) => t.id === s.taskId)
      if (!task) continue
      const cur = map.get(s.taskId) ?? { seconds: 0, count: 0, title: task.title }
      cur.seconds += s.actualSeconds
      cur.count += 1
      map.set(s.taskId, cur)
    }
    return [...map.entries()]
      .map(([taskId, v]) => ({ taskId, ...v }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, limit)
  }

  weeklyReport(from: string, to: string): string {
    const stats = this.statRange(from, to) as {
      focusCount: number
      focusSeconds: number
      completionRate: number
      daily: { date: string; count: number }[]
    }
    const top = this.taskTop(from, to, 5) as { title: string; seconds: number }[]
    const hours = Math.round((stats.focusSeconds / 3600) * 10) / 10

    const lines: string[] = [
      `# FocusOS 周报`,
      ``,
      `**区间**：${from} ~ ${to}`,
      ``,
      `## 总览`,
      ``,
      `- 完成番茄：${stats.focusCount} 个`,
      `- 专注总时长：${hours} 小时`,
      `- 完成率：${Math.round(stats.completionRate * 100)}%`,
      ``,
      `## 每日`,
      ``,
      `| 日期 | 番茄 |`,
      `| --- | --- |`,
      ...stats.daily.map((d) => `| ${d.date} | ${d.count} |`),
      ``
    ]
    if (top.length > 0) {
      lines.push(`## 投入最多的任务`, ``)
      for (const t of top) {
        lines.push(`- ${t.title}：${Math.round(t.seconds / 60)} 分钟`)
      }
      lines.push('')
    }
    return lines.join('\n')
  }

  /** 供渲染层取今日数据 */
  todayKey(): string {
    return todayKey()
  }
}

export const controller = new AppController()
