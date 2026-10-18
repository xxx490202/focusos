// ============================================================
//  index.ts — IPC handler 注册
// ============================================================
//  ⭐ ipcMain.handle 入参全部经 zod 校验。
// ============================================================
import { ipcMain, dialog, app, shell, globalShortcut } from 'electron'
import {
  IPC,
  zPlanRequest,
  zStatQuery,
  zWindowAction,
  zSettingsPatch,
  zTask,
  zId,
  zUrl,
  zDate,
  zTimerSeconds,
  zDeletedTaskSnapshot,
  zSkipInstance,
  zHabitDraft,
  zHabit,
  zHabitSetValue,
  zDayRollover
} from '@shared/ipc-contract'
import { controller } from '../app-controller'
import { idleWatcher } from '../idle-watcher'
import { windows } from '../window'
import { themeManager } from '../theme'
import { tray } from '../tray'
import { repository } from '../store/repository'
import {
  createTask,
  updateTask,
  deleteTask,
  restoreTask,
  skipRepeatInstance,
  duplicateTask,
  listTasks,
  listPlanBlocks,
  clearPlanBlocks,
  removePlanBlock,
  completeTask,
  setTaskStatus,
  blocksForRange,
  todayKey,
  listHabits,
  createHabit,
  updateHabit,
  deleteHabit,
  setHabitValue,
  rolloverUnfinished
} from '../store/task-service'
import { userBackgroundsDir, dataFile } from '../paths'
import { keyLabel, prettyAccelerator, platformKey, defaultCloseToTray, appId } from '@shared/platform'
import type { Settings } from '@shared/types'
import { scopedLogger } from '../store/logger'

const log = scopedLogger('ipc')

/** 统一包装：zod 校验 + 错误转中文 */
/**
 * 只读通道包装。
 * ⚠️ 同样要 await：Promise 不可结构化克隆，漏了就变成 `{}`。
 *    （当前这些处理器都是同步的，但类型上放开 async 以免日后踩同一个坑。）
 */
function handle<T>(channel: string, fn: (payload: unknown) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_e, payload: unknown) => {
    try {
      return { ok: true, data: await fn(payload) }
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败'
      log.error(`${channel} 失败: ${message}`)
      return { ok: false, error: message }
    }
  })
}

/**
 * 会**改动持久化数据**的通道专用包装：成功后再广播 data:changed。
 *
 * ⚠️ 之前只声明了 data:changed 契约、App.tsx 也订阅了，但主进程**从未广播过**，
 *    全靠渲染层每次改完手动 reload() 兜住。单窗口下看不出问题，
 *    但设置窗口是独立的 BrowserWindow —— 在它里面改主题/设置，
 *    主窗口完全不知情，会出现两个窗口设置不一致。
 *    统一在 mutate 里广播，跨窗口同步就自动成立了。
 *
 * 注：发起的那个窗口也会收到并 reload 一次（幂等，只是多一次很轻的读取）。
 *
 * ⭐ 必须 `await fn(payload)`。
 *    handler 里的返回值要经结构化克隆回渲染层，**Promise 不是可克隆对象** ——
 *    不 await 的话 `data` 会变成 `{}`，渲染层拿到 `r.ok === true` 却读不到内容。
 *    症状极具迷惑性：背景图导入真的把文件复制进去了，界面却毫无反应、
 *    连错误提示都没有（用户反馈「导入后在下方不显示」就是这个原因）。
 *    sysImport / sysPickBackground 都是 async 处理器，属于这条路径。
 */
function mutate<T>(channel: string, fn: (payload: unknown) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_e, payload: unknown) => {
    try {
      const data = await fn(payload)
      windows.broadcast('data:changed', null)
      return { ok: true, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败'
      log.error(`${channel} 失败: ${message}`)
      return { ok: false, error: message }
    }
  })
}

export function registerIpc(): void {
  // ============================================================
  //  启动引导
  // ============================================================
  handle(IPC.bootstrap, () => controller.bootstrap(themeManager.current_))

  // ============================================================
  //  任务
  // ============================================================
  handle(IPC.taskList, () => listTasks())

  mutate(IPC.taskCreate, (p) => {
    const parsed = zTask.partial().parse(p)
    return createTask(parsed)
  })

  mutate(IPC.taskUpdate, (p) => {
    const { id, patch } = p as { id: string; patch: unknown }
    const parsedId = zId.parse(id)
    const parsedPatch = zTask.partial().parse(patch)
    return updateTask(parsedId, parsedPatch)
  })

  mutate(IPC.taskDelete, (p) => deleteTask(zId.parse(p)))

  /** 撤销删除：快照原样写回（含被级联删掉的计划块） */
  mutate(IPC.taskRestore, (p) => restoreTask(zDeletedTaskSnapshot.parse(p)))

  /** 只跳过重复日程里的某一次 */
  mutate(IPC.taskSkipInstance, (p) => {
    const { taskId, date } = zSkipInstance.parse(p)
    return skipRepeatInstance(taskId, date)
  })

  // ============================================================
  //  习惯计数器
  // ============================================================
  handle(IPC.habitList, () => listHabits())

  mutate(IPC.habitCreate, (p) => createHabit(zHabitDraft.parse(p)))

  mutate(IPC.habitUpdate, (p) => {
    const { id, patch } = p as { id: string; patch: unknown }
    return updateHabit(zId.parse(id), zHabit.partial().parse(patch))
  })

  mutate(IPC.habitDelete, (p) => {
    deleteHabit(zId.parse(p))
    return true
  })

  mutate(IPC.habitSetValue, (p) => {
    const { id, date, value } = zHabitSetValue.parse(p)
    return setHabitValue(id, date, value)
  })

  // ============================================================
  //  结束今天（日切）
  // ============================================================
  mutate(IPC.dayRollover, (p) => {
    const { from, to } = zDayRollover.parse(p)
    return { moved: rolloverUnfinished(from, to) }
  })

  mutate(IPC.taskDuplicate, (p) => duplicateTask(zId.parse(p)))

  mutate(IPC.taskArchive, (p) => setTaskStatus(zId.parse(p), 'archived'))

  mutate(IPC.taskComplete, (p) => completeTask(zId.parse(p)))

  // ============================================================
  //  计划块
  // ============================================================
  handle(IPC.planList, () => listPlanBlocks())

  handle(IPC.planGenerate, (p) => {
    const req = zPlanRequest.parse(p)
    return controller.generatePlanPreview(req.taskIds, req.date, req.windowStart, req.windowEnd)
  })

  mutate(IPC.planCommit, (p) => {
    const date = zDate.parse(p)
    return controller.commitPlanPreview(date)
  })

  handle(IPC.planDiscard, () => {
    controller.discardPlanPreview()
    return true
  })

  mutate(IPC.planClear, (p) => {
    const { date, taskIds } = p as { date: string; taskIds?: string[] }
    clearPlanBlocks(zDate.parse(date), taskIds)
    return true
  })

  mutate(IPC.planRemove, (p) => {
    const id = zId.parse(p)
    if (!removePlanBlock(id)) throw new Error('计划块不存在，可能已被删除')
    return true
  })

  // ============================================================
  //  计时
  // ============================================================
  handle(IPC.timerGet, () => controller.engine.snapshot())
  handle(IPC.timerStart, () => {
    controller.engine.start()
    return controller.engine.snapshot()
  })
  handle(IPC.timerPause, () => {
    const ok = controller.engine.pause()
    if (!ok && controller.getSettings().strictMode) {
      throw new Error('严格模式下，专注期间不能暂停')
    }
    return controller.engine.snapshot()
  })
  handle(IPC.timerReset, () => {
    controller.engine.reset()
    return controller.engine.snapshot()
  })
  handle(IPC.timerSkip, () => {
    controller.engine.skip()
    return controller.engine.snapshot()
  })
  handle(IPC.timerBreak, () => {
    controller.engine.breakNow()
    return controller.engine.snapshot()
  })
  mutate(IPC.timerAttachTask, (p) => {
    controller.engine.attachTask(p === null ? null : zId.parse(p))
    return controller.engine.snapshot()
  })

  /*
   * 手动设定本轮倒计时。
   * ⭐ 用 handle 而不是 mutate：它**不改动持久化数据**（只改内存里的计时状态），
   *    所以不需要广播 data:changed，否则会引发一次无谓的全量 reload。
   */
  handle(IPC.timerSetDuration, (p) => {
    const seconds = zTimerSeconds.parse(p)
    controller.engine.setRemaining(seconds)
    return controller.engine.snapshot()
  })

  /** 心流模式：结束本轮专注，按配置计算休息时长 */
  handle(IPC.timerFinishFlow, () => {
    controller.engine.finishFlow()
    return controller.engine.snapshot()
  })

  /** 空闲回处理：把离开的时长补回剩余时间 */
  handle(IPC.timerDiscardIdle, (p) => {
    const seconds = zTimerSeconds.parse(p)
    controller.engine.discardIdle(seconds)
    return controller.engine.snapshot()
  })

  // ============================================================
  //  会话与统计
  // ============================================================
  handle(IPC.sessionList, () => repository.read().sessions)

  handle(IPC.statRange, (p) => {
    const q = zStatQuery.parse(p)
    return controller.statRange(q.from, q.to)
  })

  handle(IPC.taskTop, (p) => {
    const q = zStatQuery.parse(p)
    return controller.taskTop(q.from, q.to)
  })

  handle(IPC.weeklyReport, (p) => {
    const q = zStatQuery.parse(p)
    return controller.weeklyReport(q.from, q.to)
  })

  // ============================================================
  //  设置
  // ============================================================
  handle(IPC.settingsGet, () => controller.getSettings())

  mutate(IPC.settingsPatch, (p) => {
    const patch = zSettingsPatch.parse(p)
    const next = controller.patchSettings(patch)
    themeManager.remember(next.theme, next)
    const effective = themeManager.apply(next.theme, next)
    tray.onThemeChanged(effective)
    // 空闲检测的设置热更新（开关与阈值都立即生效）
    idleWatcher.configure(next.idle)
    return { settings: next, effectiveTheme: effective }
  })

  // ============================================================
  //  主题
  // ============================================================
  handle(IPC.themeGet, () => ({
    settings: controller.getSettings(),
    effective: themeManager.current_
  }))

  mutate(IPC.themeSet, (p) => {
    const { theme } = p as { theme: Settings['theme'] }
    const next = controller.patchSettings({ theme })
    const effective = themeManager.apply(theme, next)
    tray.onThemeChanged(effective)
    return effective
  })

  // ============================================================
  //  窗口
  // ============================================================
  handle(IPC.windowAction, async (p) => {
    const action = zWindowAction.parse(p)
    switch (action) {
      case 'focus-fullscreen':
        await windows.toggleFullscreen()
        break
      case 'focus-windowed':
        windows.enterFocusWindow()
        break
      case 'toggle-fullscreen':
        await windows.toggleFullscreen()
        break
      case 'open-workbench':
        windows.enterWorkbench()
        break
      case 'open-settings':
        windows.createSettingsWindow(themeManager.current_)
        break
      case 'minimize':
        windows.minimize()
        break
      case 'close':
        windows.getMain()?.close()
        break
      case 'show':
        windows.showMain()
        break
    }
    return windows.isFullScreen()
  })

  // ============================================================
  //  系统
  // ============================================================
  handle(IPC.sysOpenDataDir, () => {
    void shell.openPath(app.getPath('userData'))
    return true
  })

  handle(IPC.sysOpenExternal, (p) => {
    const url = zUrl.parse(p)
    void shell.openExternal(url)
    return true
  })

  handle(IPC.sysExport, () => controller.exportData())

  mutate(IPC.sysImport, async () => {
    const win = windows.getMain()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: '导入 FocusOS 数据',
      filters: [{ name: 'FocusOS 数据', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: '已取消' }
    }
    return controller.importData(result.filePaths[0])
  })

  mutate(IPC.sysClearData, () => {
    controller.clearAllData()
    return true
  })

  mutate(IPC.sysPickBackground, async () => {
    const win = windows.getMain()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: '选择背景图',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths.map((f) => controller.addBackground(f)).filter(Boolean)
  })

  // 过滤掉用户已「移除」的图（只在应用内移除，磁盘原图仍在）
  handle(IPC.sysBackgrounds, () => controller.visibleBackgrounds())

  // ⚠️ 用 zUrl 而不是 zId：file:// URL 经百分号编码后可能远超 128 字符
  // 删除 = 只在应用里删（记进 hidden），全程不碰磁盘文件 → 没有任何失败分支
  mutate(IPC.sysRemoveBackground, (p) => controller.removeBackground(zUrl.parse(p)))

  handle(IPC.sysPlatformInfo, () => controller.platformInfo())

  handle(IPC.sysSetLoginItem, (p) => {
    const enabled = Boolean((p as { enabled: boolean }).enabled)
    // 两平台同一 API：mac 走 LoginItems，win 写注册表
    app.setLoginItemSettings({ openAtLogin: enabled })
    controller.patchSettings({ openAtLogin: enabled })
    return enabled
  })

  handle(IPC.sysShortcutStatus, () => globalShortcut.isRegistered('CmdOrCtrl+Shift+Space'))

  // ============================================================
  //  时间轴数据（F5/F7）
  // ============================================================
  ipcMain.handle('timeline:blocks', async (_e, p: unknown) => {
    try {
      const { from, to } = p as { from: string; to: string }
      const s = controller.getSettings()
      return { ok: true, data: blocksForRange(zDate.parse(from), zDate.parse(to), s) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '读取失败' }
    }
  })

  ipcMain.handle('system:info', async () => ({
    ok: true,
    data: {
      today: todayKey(),
      dataFile: dataFile(),
      backgroundsDir: userBackgroundsDir(),
      shortcutHints: [
        { accelerator: 'CmdOrCtrl+Shift+Space', label: prettyAccelerator('CmdOrCtrl+Shift+Space') },
        { accelerator: 'CmdOrCtrl+Shift+F', label: prettyAccelerator('CmdOrCtrl+Shift+F') },
        { accelerator: 'CmdOrCtrl+Shift+N', label: prettyAccelerator('CmdOrCtrl+Shift+N') },
        { accelerator: 'CmdOrCtrl+Shift+D', label: prettyAccelerator('CmdOrCtrl+Shift+D') }
      ],
      keys: { mod: keyLabel('mod'), alt: keyLabel('alt'), shift: keyLabel('shift') },
      platform: platformKey(),
      appId: appId(),
      defaultCloseToTray: defaultCloseToTray()
    }
  }))

  log.info('IPC 通道注册完成')
}
