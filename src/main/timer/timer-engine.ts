// ============================================================
//  timer-engine.ts — 无漂移计时引擎
// ============================================================
//  ⭐ 绝不用 remaining -= 1 式递减计数。
//     一切基于 endsAt - Date.now() 的差值，因此：
//     · 连续跑 2 小时累计误差 ≤ 2 秒
//     · 休眠 8 小时回来剩余时间照样准
//     · powerMonitor 事件只用于「补响漏掉的阶段提示音」，不影响精度
//
//  ⭐ 本模块两平台完全一致，不写任何平台分支。
// ============================================================
import type { TimerState, TimerPhase, TimerStatus, PhaseDurations, FlowtimeSettings } from '@shared/types'
import { onWake } from '@shared/platform'

export interface TimerEvents {
  /** 每当显示秒数变化 */
  onTick(state: TimerState): void
  /** 阶段自然走完（completed=true） */
  onPhaseComplete(phase: TimerPhase, endedAt: number): void
  /** 唤醒后补响：被跳过的阶段逐个回调 */
  onCatchUp(phases: TimerPhase[], endedAt: number): void
  /** 阶段切换（含跳过） */
  onPhaseChange(phase: TimerPhase): void
  /** 专注自然走完 → 计入统计 */
  onFocusCompleted(info: {
    taskId: string | null
    plannedSeconds: number
    actualSeconds: number
    startedAt: number
    endedAt: number
    cycleIndex: number
  }): void
  /** 状态机任何变化（用于持久化恢复） */
  onStateChange(state: TimerState): void
}

const TICK_MS = 250
/** 归零后先响铃，延迟 500ms 再切阶段 */
const CHIME_DELAY_MS = 500

export class TimerEngine {
  private state: TimerState
  private events: TimerEvents
  private durations: PhaseDurations
  private longBreakEvery: number
  private autoStartNextPhase: boolean
  private strictMode: boolean

  /**
   * 心流模式（focusMode='flowtime'）。
   * ⭐ 与番茄钟的唯一结构差异：专注阶段**只记起点、不设终点**。
   *    · 不倒计时、不响铃、不会自然归零
   *    · 用户按「结束这一轮」时才结算，休息时长按已专注时长反算
   *    休息阶段仍然走原来的倒计时路径，所以精度逻辑一行都不用改。
   */
  private flowMode = false
  private flowtimeCfg: FlowtimeSettings = {
    breakEnabled: true,
    breakMode: 'ratio',
    breakPercent: 20,
    breakRules: []
  }

  private ticker: NodeJS.Timeout | null = null
  private chimeTimer: NodeJS.Timeout | null = null
  private unwake: (() => void) | null = null

  /** 过渡锁：响铃到切阶段之间锁定开始/暂停，防双击竞态 */
  private transitioning = false

  /**
   * 用户手动改写的**本轮**总时长（秒），null = 未改写。
   *
   * ⭐ 「只改这一轮」的实现要点：
   *    · 设置后覆盖 remainingSeconds，RUNNING 时同步重算 endsAt
   *    · IDLE 下按开始**不会**被重置回默认时长（否则改了等于没改）
   *    · reset / 跳过 / 立即休息 / 阶段自然切换后一律清空 —— 下一轮回到默认
   *    · 结算 Session 时用它当 plannedSeconds，统计才不会被 25 分钟的默认值污染
   */
  private customTotal: number | null = null

  /** 手动设定的下限：1 秒。允许 0 会让「改完立刻归零响铃」这种怪状态出现 */
  private static readonly MIN_MANUAL_SECONDS = 1
  /** 上限与显示格式对齐（MM:SS，分位两位） */
  private static readonly MAX_MANUAL_SECONDS = 99 * 60 + 59

  /** 注入的时钟，单测可控 */
  constructor(
    events: TimerEvents,
    durations: PhaseDurations,
    opts: {
      longBreakEvery?: number
      autoStartNextPhase?: boolean
      strictMode?: boolean
      flowMode?: boolean
      flowtime?: FlowtimeSettings
      now?: () => number
    } = {}
  ) {
    this.events = events
    this.durations = durations
    this.longBreakEvery = opts.longBreakEvery ?? 4
    this.autoStartNextPhase = opts.autoStartNextPhase ?? true
    this.strictMode = opts.strictMode ?? false
    this.flowMode = opts.flowMode ?? false
    if (opts.flowtime) this.flowtimeCfg = opts.flowtime
    this.now = opts.now ?? (() => Date.now())

    this.state = {
      phase: 'focus',
      status: 'IDLE',
      taskId: null,
      endsAt: null,
      remainingSeconds: durations.workMinutes * 60,
      elapsedSeconds: 0,
      countingUp: false,
      cycleIndex: 0,
      phaseStartedAt: null,
      strictMode: this.strictMode,
      interruptCount: 0
    }
  }

  private now: () => number

  // ============================================================
  //  配置
  // ============================================================

  configure(opts: {
    durations?: PhaseDurations
    longBreakEvery?: number
    autoStartNextPhase?: boolean
    strictMode?: boolean
    flowMode?: boolean
    flowtime?: FlowtimeSettings
  }): void {
    if (opts.durations) this.durations = opts.durations
    if (opts.longBreakEvery !== undefined) this.longBreakEvery = opts.longBreakEvery
    if (opts.autoStartNextPhase !== undefined) {
      this.autoStartNextPhase = opts.autoStartNextPhase
    }
    if (opts.strictMode !== undefined) {
      this.strictMode = opts.strictMode
      this.state.strictMode = opts.strictMode
    }
    if (opts.flowtime !== undefined) this.flowtimeCfg = opts.flowtime
    if (opts.flowMode !== undefined) {
      this.flowMode = opts.flowMode
      this.state.countingUp = this.isCountingUp()
    }
    // 仅在 IDLE 且未跑完时同步新的阶段时长
    if (this.state.status === 'IDLE') {
      const seconds = this.secondsFor(this.state.phase)
      if (this.state.remainingSeconds === 0 || !this.state.phaseStartedAt) {
        this.state.remainingSeconds = seconds
      }
    }
    this.push()
  }

  /** 当前是否处于「正计时」——只有心流模式的专注阶段是 */
  private isCountingUp(): boolean {
    return this.flowMode && this.state.phase === 'focus' && this.state.status === 'RUNNING'
  }

  private secondsFor(phase: TimerPhase): number {
    switch (phase) {
      case 'focus':
        return this.durations.workMinutes * 60
      case 'shortBreak':
        return this.durations.shortBreakMinutes * 60
      case 'longBreak':
        return this.durations.longBreakMinutes * 60
    }
  }

  // ============================================================
  //  生命周期
  // ============================================================

  start(): void {
    if (this.transitioning) return
    if (this.state.status === 'RUNNING') return

    const t = this.now()

    /*
     * 心流模式：专注阶段是**正计时**，没有结束点、不会自然归零。
     * · IDLE   → 全新一轮：已专注时长清零
     * · PAUSED → 接着走：把起点回拨 elapsed 秒，等效于「已经专注了 elapsed 秒」
     *   （不能简单地用 now 当起点，否则暂停期间的时间会被吞掉）
     */
    if (this.flowMode && this.state.phase === 'focus') {
      this.clearCustom()
      const elapsed = this.state.status === 'IDLE' ? 0 : this.state.elapsedSeconds
      this.state.elapsedSeconds = elapsed
      this.state.remainingSeconds = elapsed
      this.state.phaseStartedAt = t - elapsed * 1000
      this.state.endsAt = null
      this.state.status = 'RUNNING'
      this.state.countingUp = true
      this.ensureTicker()
      this.push()
      return
    }

    if (this.state.status === 'IDLE') {
      /*
       * 全新开始：重置为当前阶段的完整时长。
       * ⚠️ 例外：用户手动改写过本轮时长时不重置 ——
       *    「只改这一轮」意味着改完按开始必须还是那个值，
       *    否则改完一按开始就被打回默认，等于白改。
       */
      if (this.customTotal === null) {
        this.state.remainingSeconds = this.secondsFor(this.state.phase)
      }
      this.state.phaseStartedAt = t
    }
    // PAUSED → 用剩余秒数重算 endsAt
    this.state.endsAt = t + this.state.remainingSeconds * 1000
    this.state.status = 'RUNNING'
    this.ensureTicker()
    this.push()
  }

  pause(): boolean {
    // 严格模式：专注中不允许暂停
    if (this.strictMode && this.state.phase === 'focus' && this.state.status === 'RUNNING') {
      this.push()
      return false
    }
    if (this.state.status !== 'RUNNING') return false
    // 把剩余秒数落回，endsAt 清空
    this.tick()
    this.state.endsAt = null
    this.state.status = 'PAUSED'
    this.stopTicker()
    this.push()
    return true
  }

  /**
   * 手动设定**本轮**倒计时（专注页点击分/秒后调用）。
   *
   * ⭐ 只改这一轮：不写回 settings，且会在 reset / 跳过 / 立即休息 /
   *    阶段自然切换后自动失效（见各处的 clearCustom）。
   * 运行中改时同步重算 endsAt，因此改完继续走，不会跳变或停顿。
   */
  setRemaining(seconds: number): void {
    const s = Math.max(
      TimerEngine.MIN_MANUAL_SECONDS,
      Math.min(TimerEngine.MAX_MANUAL_SECONDS, Math.round(seconds))
    )
    this.customTotal = s
    this.state.remainingSeconds = s

    if (this.state.status === 'RUNNING') {
      const t = this.now()
      // 被手动改过的这一轮，phaseStartedAt 必须存在，否则 actualSeconds 会失真
      if (this.state.phaseStartedAt === null) this.state.phaseStartedAt = t
      this.state.endsAt = t + s * 1000
      this.ensureTicker()
    } else {
      this.state.endsAt = null
    }
    this.push()
  }

  /** 清空手动改写（进入下一轮 / 重置时调用） */
  private clearCustom(): void {
    this.customTotal = null
  }

  /** 「⟳ Reset」：停止一切并回到当前阶段满时长，不污染统计 */
  reset(): void {
    this.clearChime()
    this.transitioning = false
    this.clearCustom()
    this.state.phase = 'focus'
    this.state.status = 'IDLE'
    this.state.endsAt = null
    this.state.remainingSeconds = this.durations.workMinutes * 60
    this.state.elapsedSeconds = 0
    this.state.countingUp = false
    this.state.phaseStartedAt = null
    this.state.cycleIndex = 0
    this.stopTicker()
    this.events.onPhaseChange('focus')
    this.push()
  }

  /** 「跳过阶段」：手动进入下一阶段并计为未完成 */
  skip(): void {
    this.clearChime()
    this.transitioning = false
    this.clearCustom()
    this.endCurrentPhase({ completed: false, skipped: true })
    this.advance({ autoStart: false })
  }

  /** 「☕ Break」：从任意状态直接进入一个运行中的休息，结束后自动切回专注 */
  breakNow(): void {
    this.clearChime()
    this.transitioning = false
    this.clearCustom()
    this.endCurrentPhase({ completed: false, skipped: false })
    this.state.phase = 'shortBreak'
    this.state.remainingSeconds = this.durations.shortBreakMinutes * 60
    this.state.elapsedSeconds = 0
    this.state.countingUp = false
    this.state.phaseStartedAt = this.now()
    this.state.status = 'RUNNING'
    this.state.endsAt = this.now() + this.state.remainingSeconds * 1000
    this.ensureTicker()
    this.events.onPhaseChange('shortBreak')
    this.push()
  }

  // ============================================================
  //  心流模式（focusMode='flowtime'）
  // ============================================================

  /**
   * 用户按「结束这一轮」。
   *
   * ⭐ 与番茄钟的区别在于**结算的触发权在人手里**：
   *    先把已专注时长落下来，再按配置反算出休息时长。
   *    统计口径不变 —— 仍记 1 个完成专注，plannedSeconds 用实际时长，
   *    这样「今日专注时长」「时段热力图」不会因为换了模式而失真。
   */
  finishFlow(): void {
    if (!this.isCountingUp()) return

    this.tick() // 把最后一秒的进度落下来
    const elapsed = this.state.elapsedSeconds

    this.clearChime()
    this.transitioning = false
    this.clearCustom()

    this.endCurrentPhase({ completed: true, skipped: false, plannedSeconds: elapsed })
    this.state.elapsedSeconds = 0
    this.state.countingUp = false

    const brk = this.flowBreakFor(elapsed)
    if (brk === null) {
      // 不休息：停在心流专注态的空闲状态，可以直接再开一轮
      this.state.phase = 'focus'
      this.state.status = 'IDLE'
      this.state.endsAt = null
      this.state.phaseStartedAt = null
      this.state.remainingSeconds = this.secondsFor('focus')
      this.stopTicker()
      this.events.onPhaseChange('focus')
      this.push()
      return
    }

    this.state.phase = 'shortBreak'
    this.state.remainingSeconds = brk.minutes * 60
    this.state.phaseStartedAt = this.now()
    this.state.status = 'RUNNING'
    this.state.endsAt = this.now() + this.state.remainingSeconds * 1000
    this.ensureTicker()
    this.events.onPhaseChange('shortBreak')
    this.push()
  }

  /**
   * 按心流配置反算休息时长（分钟）。
   * · ratio —— 休息 = 已专注 × 百分比，**最少 1 分钟**
   *   （不设下限的话，专注 2 分钟会算出 24 秒休息，等于没休）
   * · rules —— 取第一条命中的分段规则（半开区间）；一条都没命中就不休息
   */
  private flowBreakFor(elapsedSeconds: number): { minutes: number } | null {
    const cfg = this.flowtimeCfg
    if (!cfg.breakEnabled || elapsedSeconds <= 0) return null

    if (cfg.breakMode === 'ratio') {
      const percent = Math.max(0, cfg.breakPercent)
      if (percent <= 0) return null
      const seconds = Math.max(60, Math.round(elapsedSeconds * (percent / 100)))
      return { minutes: Math.max(1, Math.round(seconds / 60)) }
    }

    const minutes = elapsedSeconds / 60
    const hit = cfg.breakRules.find(
      (r) => minutes >= r.minMinutes && (r.maxMinutes === null || minutes < r.maxMinutes)
    )
    return hit ? { minutes: hit.breakMinutes } : null
  }

  /**
   * 空闲回处理：把「人不在」的那段时间从计时里扣掉。
   * 等效于「离开期间自动暂停」：
   * · 倒计时 → 剩余秒数增加、endsAt 顺延
   * · 正计时 → 已专注时长减少、起点后移
   * ⚠️ phaseStartedAt 必须一起后移，否则 actualSeconds 仍会把离开的时间算进去，
   *    「今日专注时长」照样是虚高的。
   */
  discardIdle(seconds: number): void {
    const s = Math.max(0, Math.round(seconds))
    if (s === 0) return

    if (this.flowMode && this.state.phase === 'focus') {
      this.state.elapsedSeconds = Math.max(0, this.state.elapsedSeconds - s)
      this.state.remainingSeconds = this.state.elapsedSeconds
      if (this.state.phaseStartedAt !== null) this.state.phaseStartedAt += s * 1000
      this.push()
      return
    }

    if (this.state.status === 'RUNNING' && this.state.endsAt !== null) {
      this.state.endsAt += s * 1000
      this.state.remainingSeconds = this.remainingFromEndsAt(this.state.endsAt)
    } else {
      this.state.remainingSeconds += s
    }
    if (this.state.phaseStartedAt !== null) this.state.phaseStartedAt += s * 1000
    this.push()
  }

  attachTask(taskId: string | null): void {
    this.state.taskId = taskId
    this.push()
  }

  /** 严格模式下强行退出计入中断次数 */
  noteInterrupt(): void {
    this.state.interruptCount += 1
    this.push()
  }

  // ============================================================
  //  恢复（窗口崩溃 / 刷新后）
  // ============================================================

  /** 从持久化状态恢复；若 endsAt 已过则立即校正并补齐阶段 */
  restore(snapshot: TimerState): void {
    this.state = { ...snapshot }
    this.state.strictMode = this.strictMode
    if (this.state.status === 'RUNNING' && this.state.endsAt !== null) {
      this.state.remainingSeconds = this.remainingFromEndsAt(this.state.endsAt)
      if (this.state.remainingSeconds <= 0) {
        // 恢复时已跨过结束点 → 校正并补齐
        this.correctAfterWake()
        return
      }
      this.ensureTicker()
    } else if (this.state.status === 'RUNNING' && this.flowMode && this.state.phase === 'focus') {
      /*
       * 心流正计时没有 endsAt，上面的分支进不来。
       * 不补这一支的话，刷新/重启后计时器会「卡在 RUNNING 但不再走」。
       */
      this.state.countingUp = true
      this.ensureTicker()
    }
    this.push()
  }

  snapshot(): TimerState {
    return { ...this.state }
  }

  isTransitioning(): boolean {
    return this.transitioning
  }

  // ============================================================
  //  核心：差值计算
  // ============================================================

  private remainingFromEndsAt(endsAt: number): number {
    return Math.max(0, Math.ceil((endsAt - this.now()) / 1000))
  }

  private ensureTicker(): void {
    if (this.ticker) return
    this.ticker = setInterval(() => this.tick(), TICK_MS)
  }

  private stopTicker(): void {
    if (!this.ticker) return
    clearInterval(this.ticker)
    this.ticker = null
  }

  private tick(): void {
    if (this.state.status !== 'RUNNING') return

    // ---- 心流正计时：只累计已专注时长，永不判归零 ----
    if (this.isCountingUp()) {
      if (this.state.phaseStartedAt === null) return
      const elapsed = Math.max(0, Math.floor((this.now() - this.state.phaseStartedAt) / 1000))
      // 仅当显示秒数变化才推送，避免高频重渲染
      if (elapsed === this.state.elapsedSeconds) return
      this.state.elapsedSeconds = elapsed
      this.state.remainingSeconds = elapsed
      this.events.onTick(this.state)
      return
    }

    if (this.state.endsAt === null) return

    const remaining = this.remainingFromEndsAt(this.state.endsAt)

    // 仅当显示秒数变化才推送，避免高频重渲染
    if (remaining === this.state.remainingSeconds) return

    this.state.remainingSeconds = remaining
    this.events.onTick(this.state)

    if (remaining <= 0) this.completePhase()
  }

  /** 阶段归零：响铃 → 500ms → 切阶段 */
  private completePhase(): void {
    this.transitioning = true
    this.clearChime()
    // 走统一的补齐路径：missed.length === 1 时即「正常归零」，
    // 响铃一次、走 500ms 再切阶段，行为与规范一致
    this.runCatchUp()
  }

  /**
   * 统一的「归零 / 唤醒补齐」处理。
   *
   * ⚠️ 用**绝对时间游标**推演，而不是每次从 now() 重算 endsAt——
   *    后者会把已经流逝的时间抹掉，导致跨 8 小时只能补 1 个阶段。
   *
   * 顺序严格遵守规范：**先响铃 → setTimeout(500) → 切阶段**。
   * 这里只结算已越过的阶段（写统计、累加 cycleIndex），
   * 把新阶段暂存在局部变量，500ms 提示音播完才落到 state。
   * 这 500ms 内 transitioning = true，禁用开始/暂停，防双击竞态。
   */
  private runCatchUp(): void {
    this.stopTicker()

    const now = this.now()
    // 游标：当前阶段的绝对结束时刻
    let cursor = this.state.endsAt ?? now
    let phase = this.state.phase
    let cycleIndex = this.state.cycleIndex

    const missed: TimerPhase[] = []
    // 防御性上限：单次最多补 200 个阶段（约 83 小时的番茄），避免死循环
    let guard = 0
    this.catchUpRunning = true
    try {
      while (cursor <= now && guard < 200) {
        guard++
        missed.push(phase)
        // 以游标时刻作为该阶段的真实结束时间，actualSeconds 才准确
        this.endCurrentPhase({ completed: true, skipped: false, endedAt: cursor })
        // ⚠️ endCurrentPhase 会对「完成的专注」累加 state.cycleIndex，
        //    必须立刻同步回本地变量，否则推演用的 cycleIndex 会停滞，
        //    导致长休息永远不触发
        cycleIndex = this.state.cycleIndex

        const next = this.nextPhaseFor(phase, cycleIndex)
        phase = next.phase
        // 游标推进到下一阶段的结束时刻（绝对时间，不受 now() 影响）
        cursor += this.secondsFor(phase) * 1000
      }
    } finally {
      this.catchUpRunning = false
      // 推演结束：把 phaseStartedAt 顺延到最后一个已结束阶段的时刻
      this.state.phaseStartedAt = cursor - this.secondsFor(phase) * 1000
      this.state.endsAt = null
    }

    if (missed.length === 0) {
      // 未真正归零（理论上不会发生），保守处理
      this.transitioning = false
      this.state.remainingSeconds = this.remainingFromEndsAt(cursor)
      this.state.endsAt = cursor
      this.state.status = 'RUNNING'
      this.ensureTicker()
      this.push()
      return
    }

    // ⭐ 补响：响铃次数 = 被跳过的阶段数，不是只响一次
    this.events.onCatchUp(missed, now)

    const nextPhaseName = phase
    const nextCycleIndex = cycleIndex
    const nextEndsAt = cursor
    const nextRemaining = this.remainingFromEndsAt(cursor)

    this.chimeTimer = setTimeout(() => {
      this.chimeTimer = null
      this.transitioning = false
      // 阶段已经切走 → 手动改写随之失效
      this.clearCustom()

      // 500ms 提示音播完，此刻才真正切阶段
      this.state.phase = nextPhaseName
      this.state.cycleIndex = nextCycleIndex
      this.state.remainingSeconds = nextRemaining
      this.state.endsAt = nextEndsAt
      // 换阶段一律退出正计时（心流只在专注阶段用正计时）
      this.state.elapsedSeconds = 0
      this.state.countingUp = false

      this.state.status = this.autoStartNextPhase ? 'RUNNING' : 'IDLE'
      if (this.state.status === 'RUNNING') {
        this.ensureTicker()
      } else {
        this.state.endsAt = null
        this.state.phaseStartedAt = null
      }

      this.events.onPhaseChange(this.state.phase)
      this.push()
    }, CHIME_DELAY_MS)
  }

  /**
   * 唤醒 / 恢复后的校正入口。
   * 若跨过了多个阶段，逐个补响提示音（响铃次数 = 跳过阶段数）。
   */
  private correctAfterWake(): void {
    this.transitioning = false
    this.clearChime()
    this.state.remainingSeconds = this.state.endsAt
      ? this.remainingFromEndsAt(this.state.endsAt)
      : this.state.remainingSeconds
    this.runCatchUp()
  }

  /** 结束当前阶段，写Session / 计数 */
  private endCurrentPhase(opts: {
    completed: boolean
    skipped: boolean
    endedAt?: number
    /** 覆盖「计划时长」：心流模式按实际已专注时长结算 */
    plannedSeconds?: number
  }): void {
    const { phase, taskId } = this.state
    const endedAt = opts.endedAt ?? this.now()
    /*
     * ⭐ 手动改写是「一次性」的：本轮结算时就地消费掉。
     *
     * ⚠️ 不能用 catchUpRunning 来区分「当前轮 / 历史轮」——
     *    正常归零走的也是 runCatchUp 这条路径（首轮结算的正是当前这一轮），
     *    按它过滤会把「手改成 10 分钟然后专心做完」记成 planned=25 分钟，
     *    统计与周报立刻失真。
     *    消费式处理天然正确：catch-up 推演中首轮吃掉 customTotal，
     *    其后的历史轮拿到的已经是 null，回落到设置里的阶段时长。
     */
    const planned = opts.plannedSeconds ?? this.customTotal ?? this.secondsFor(phase)
    this.customTotal = null
    // phaseStartedAt 为空时（补齐推演中）退回到「按计划时长」推算，
    // 保证 actualSeconds 不为负、也不会因为系统时间跳跃而失真
    const started = this.state.phaseStartedAt ?? endedAt - planned * 1000
    const actual = Math.max(0, Math.round((endedAt - started) / 1000))

    if (phase === 'focus') {
      // ⭐ 完成番茄数只在专注自然走完时 +1；
      //    休息、跳过、手动重置、中断均不计
      if (opts.completed) {
        this.events.onFocusCompleted({
          taskId,
          plannedSeconds: planned,
          actualSeconds: actual,
          startedAt: started,
          endedAt,
          cycleIndex: this.state.cycleIndex
        })
        this.state.cycleIndex += 1
      }
    } else {
      this.events.onPhaseComplete(phase, endedAt)
    }

    // ⭐ 只在最后一轮清空；补齐推演中 phaseStartedAt 必须保留，
    //    否则下一阶段的 actualSeconds 会算成 0
    if (!this.catchUpRunning) {
      this.state.phaseStartedAt = null
      this.state.endsAt = null
    }
  }

  /** runCatchUp 推演期间为 true */
  private catchUpRunning = false

  /**
   * 计算下一阶段。
   * cycleIndex 已在 endCurrentPhase 里对「完成的专注」+1，
   * 因此这里只读取、绝不重复累加（否则长休息会提前一轮触发）。
   */
  private nextPhase(): { phase: TimerPhase; cycleIndex: number } {
    return this.nextPhaseFor(this.state.phase, this.state.cycleIndex)
  }

  private nextPhaseFor(
    phase: TimerPhase,
    cycleIndex: number
  ): { phase: TimerPhase; cycleIndex: number } {
    if (phase !== 'focus') {
      return { phase: 'focus', cycleIndex }
    }
    const needLong = cycleIndex > 0 && cycleIndex % this.longBreakEvery === 0
    return { phase: needLong ? 'longBreak' : 'shortBreak', cycleIndex }
  }

  /** 进入下一阶段并按需自动开始 */
  private advance(opts: { autoStart: boolean }): void {
    const { phase, cycleIndex } = this.nextPhase()
    this.clearCustom()
    this.state.phase = phase
    this.state.cycleIndex = cycleIndex
    this.state.remainingSeconds = this.secondsFor(phase)
    this.state.elapsedSeconds = 0
    this.state.countingUp = false

    const shouldRun = opts.autoStart ? this.autoStartNextPhase : false
    if (shouldRun) {
      this.state.phaseStartedAt = this.now()
      this.state.status = 'RUNNING'
      this.state.endsAt = this.now() + this.state.remainingSeconds * 1000
      this.ensureTicker()
    } else {
      this.state.status = 'IDLE'
      this.state.phaseStartedAt = null
      this.state.endsAt = null
      this.stopTicker()
    }

    this.events.onPhaseChange(phase)
    this.push()
  }

  // ============================================================
  //  电源事件（唯一用途：补响漏掉的提示音）
  // ============================================================

  /**
   * ⚠️ suspend/resume 只有 macOS 有；Windows 只有 lock-screen/unlock-screen。
   *    Windows 上锁屏 ≠ 睡眠，但作为「可能发生大幅时间跳跃」的信号做一次校正是合理的。
   *    计时精度本身不依赖这些事件。
   */
  attachPowerEvents(): void {
    this.unwake?.()
    this.unwake = onWake(() => {
      if (this.state.status !== 'RUNNING') return
      const remaining = this.state.endsAt
        ? this.remainingFromEndsAt(this.state.endsAt)
        : this.state.remainingSeconds
      if (remaining <= 0) {
        this.state.remainingSeconds = 0
        this.correctAfterWake()
      } else if (remaining !== this.state.remainingSeconds) {
        this.state.remainingSeconds = remaining
        this.push()
      }
    })
  }

  detachPowerEvents(): void {
    this.unwake?.()
    this.unwake = null
  }

  private clearChime(): void {
    if (this.chimeTimer) {
      clearTimeout(this.chimeTimer)
      this.chimeTimer = null
    }
  }

  private push(): void {
    this.events.onTick(this.state)
    this.events.onStateChange(this.state)
  }

  dispose(): void {
    this.stopTicker()
    this.clearChime()
    this.detachPowerEvents()
  }

  // ============================================================
  //  测试辅助
  // ============================================================

  /** 仅供单测：直接注入状态 */
  __setState(patch: Partial<TimerState>): void {
    this.state = { ...this.state, ...patch }
  }

  __getState(): TimerState {
    return { ...this.state }
  }

  __setNow(fn: () => number): void {
    this.now = fn
  }

  /** 手动触发一次 tick，替代定时器 */
  __tick(): void {
    this.tick()
  }
}

export type { TimerStatus }
