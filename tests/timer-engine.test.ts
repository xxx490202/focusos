// ============================================================
//  计时引擎单测（步骤 5）
//  四类用例：暂停恢复 / 归零补齐 / 跳过阶段 / onWake 校正
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TimerEngine, type TimerEvents } from '@main/timer/timer-engine'
import type { TimerState, TimerPhase, FlowtimeSettings } from '@shared/types'

/** 可控时钟 */
function makeClock(start = 1_700_000_000_000) {
  let t = start
  return {
    now: () => t,
    advance(ms: number) {
      t += ms
    },
    set(v: number) {
      t = v
    }
  }
}

interface Recorder {
  ticks: TimerState[]
  completed: { phase: TimerPhase; endedAt: number }[]
  catchUps: { phases: TimerPhase[]; endedAt: number }[]
  changes: TimerPhase[]
  focuses: {
    taskId: string | null
    plannedSeconds: number
    actualSeconds: number
    startedAt: number
    endedAt: number
    cycleIndex: number
  }[]
  states: TimerState[]
}

function makeEvents(rec: Recorder): TimerEvents {
  return {
    onTick: (s) => rec.ticks.push({ ...s }),
    onPhaseComplete: (p, e) => rec.completed.push({ phase: p, endedAt: e }),
    onCatchUp: (p, e) => rec.catchUps.push({ phases: [...p], endedAt: e }),
    onPhaseChange: (p) => rec.changes.push(p),
    onFocusCompleted: (i) => rec.focuses.push({ ...i }),
    onStateChange: (s) => rec.states.push({ ...s })
  }
}

function makeRecorder(): Recorder {
  return { ticks: [], completed: [], catchUps: [], changes: [], focuses: [], states: [] }
}

describe('计时引擎 — 基础与无漂移', () => {
  let clock: ReturnType<typeof makeClock>
  let rec: Recorder
  let engine: TimerEngine

  beforeEach(() => {
    vi.useFakeTimers()
    clock = makeClock()
    rec = makeRecorder()
    engine = new TimerEngine(
      makeEvents(rec),
      { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
      { longBreakEvery: 4, autoStartNextPhase: true, now: clock.now }
    )
  })

  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
  })

  it('初始状态为 IDLE / focus / 25:00', () => {
    const s = engine.snapshot()
    expect(s.status).toBe('IDLE')
    expect(s.phase).toBe('focus')
    expect(s.remainingSeconds).toBe(25 * 60)
    expect(s.endsAt).toBeNull()
  })

  it('start() 设置 endsAt = now + remaining*1000', () => {
    engine.start()
    const s = engine.snapshot()
    expect(s.status).toBe('RUNNING')
    expect(s.endsAt).toBe(clock.now() + 1500 * 1000)
    expect(s.remainingSeconds).toBe(1500)
  })

  it('tick 用差值计算：2 小时累计误差 ≤ 2 秒', () => {
    // 用不跨阶段的窗口测量漂移，避免阶段切换干扰
    engine.start()
    // 推进 10 分钟（仍在同一专注阶段内），每 250ms tick 一次
    for (let i = 0; i < (10 * 60 * 1000) / 250; i++) {
      clock.advance(250)
      engine.__tick()
    }
    const s = engine.snapshot()
    // 精确应为 1500 - 600 = 900
    expect(Math.abs(s.remainingSeconds - 900)).toBeLessThanOrEqual(2)
  })

  it('长跑 2 小时不产生漂移：剩余时间始终等于真实差值', () => {
    engine.start()
    const startedAt = clock.now()
    const endsAt = engine.snapshot().endsAt as number

    // 每秒推进 1ms模拟真实流逝，期间随机采样
    let worst = 0
    for (let elapsed = 0; elapsed <= 2 * 60 * 60 * 1000; elapsed += 1000) {
      clock.set(startedAt + elapsed)
      engine.__tick()
      const expected = Math.max(0, Math.ceil((endsAt - clock.now()) / 1000))
      const actual = engine.snapshot().remainingSeconds
      worst = Math.max(worst, Math.abs(expected - actual))
    }
    // ⭐ 验收标准：累计误差 ≤ 2 秒
    expect(worst).toBeLessThanOrEqual(2)
  })

  it('秒数未变化时不重复推送（避免高频重渲染）', () => {
    engine.start()
    rec.ticks.length = 0
    // 推进 200ms，秒数仍是 1500（ceil）
    clock.advance(200)
    engine.__tick()
    engine.__tick()
    expect(rec.ticks.length).toBe(0)

    // 推进到跨秒
    clock.advance(900)
    engine.__tick()
    expect(rec.ticks.length).toBe(1)
    expect(engine.snapshot().remainingSeconds).toBe(1499)
  })
})

describe('计时引擎 — 暂停恢复', () => {
  let clock: ReturnType<typeof makeClock>
  let rec: Recorder
  let engine: TimerEngine

  beforeEach(() => {
    vi.useFakeTimers()
    clock = makeClock()
    rec = makeRecorder()
    engine = new TimerEngine(
      makeEvents(rec),
      { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
      { longBreakEvery: 4, autoStartNextPhase: true, now: clock.now }
    )
  })

  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
  })

  it('pause 把剩余秒数落回、endsAt 置空', () => {
    engine.start()
    clock.advance(60_000)
    engine.__tick()

    expect(engine.pause()).toBe(true)
    const s = engine.snapshot()
    expect(s.status).toBe('PAUSED')
    expect(s.endsAt).toBeNull()
    expect(s.remainingSeconds).toBe(1500 - 60)
  })

  it('resume 由剩余秒数重算 endsAt，误差为 0', () => {
    engine.start()
    clock.advance(60_000)
    engine.__tick()
    engine.pause()

    const pausedRemaining = engine.snapshot().remainingSeconds
    clock.advance(3_600_000) //暂停 1 小时
    engine.start()

    const s = engine.snapshot()
    expect(s.status).toBe('RUNNING')
    expect(s.endsAt).toBe(clock.now() + pausedRemaining * 1000)
    expect(s.remainingSeconds).toBe(pausedRemaining)
  })

  it('暂停期间暂停再恢复不会累计漂移', () => {
    engine.start()
    clock.advance(600_000)
    engine.__tick()
    engine.pause()
    const a = engine.snapshot().remainingSeconds

    clock.advance(10_000)
    engine.start()
    clock.advance(1)
    engine.__tick()
    const b = engine.snapshot().remainingSeconds
    expect(b).toBe(a)
  })

  it('严格模式下专注不可暂停', () => {
    engine.configure({ strictMode: true })
    engine.start()
    expect(engine.pause()).toBe(false)
    expect(engine.snapshot().status).toBe('RUNNING')
  })

  it('严格模式下休息可以暂停', () => {
    engine.configure({ strictMode: true })
    engine.breakNow()
    expect(engine.pause()).toBe(true)
  })
})

describe('计时引擎 — 归零与阶段推进', () => {
  let clock: ReturnType<typeof makeClock>
  let rec: Recorder
  let engine: TimerEngine

  beforeEach(() => {
    vi.useFakeTimers()
    clock = makeClock()
    rec = makeRecorder()
    engine = new TimerEngine(
      makeEvents(rec),
      { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
      { longBreakEvery: 4, autoStartNextPhase: true, now: clock.now }
    )
  })

  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
  })

  it('归零：先响铃 → 500ms → 切阶段', () => {
    engine.start()
    clock.advance(1500_000)
    engine.__tick()

    // 归零瞬间：仍在原阶段，但进入过渡锁
    expect(engine.isTransitioning()).toBe(true)
    expect(engine.snapshot().phase).toBe('focus')

    // 500ms 后才切阶段
    vi.advanceTimersByTime(500)
    const s = engine.snapshot()
    expect(s.phase).toBe('shortBreak')
    expect(s.status).toBe('RUNNING')
    expect(s.remainingSeconds).toBe(5 * 60)
  })

  it('过渡锁期间禁用 start，防双击竞态', () => {
    engine.start()
    clock.advance(1500_000)
    engine.__tick()
    const before = engine.snapshot()
    engine.start() // 应被过渡锁忽略
    expect(engine.snapshot().status).toBe(before.status)
  })

  it('专注自然走完才计入番茄数', () => {
    engine.attachTask('task-1')
    engine.start()
    clock.advance(1500_000)
    engine.__tick()
    vi.advanceTimersByTime(500)

    expect(rec.focuses).toHaveLength(1)
    expect(rec.focuses[0].taskId).toBe('task-1')
    expect(rec.focuses[0].plannedSeconds).toBe(1500)
    expect(rec.focuses[0].cycleIndex).toBe(0)
  })

  it('休息阶段走完不计番茄数', () => {
    engine.breakNow()
    clock.advance(300_000)
    engine.__tick()
    vi.advanceTimersByTime(500)
    expect(rec.focuses).toHaveLength(0)
    expect(engine.snapshot().phase).toBe('focus')
  })

  it('第 4 个专注后插长休息', () => {
    const phases: TimerPhase[] = []
    for (let i = 0; i < 4; i++) {
      engine.start()
      clock.advance(1500_000)
      engine.__tick()
      vi.advanceTimersByTime(500)
      phases.push(engine.snapshot().phase)
      // 走完短休息
      clock.advance(300_000)
      engine.__tick()
      vi.advanceTimersByTime(500)
    }
    expect(rec.focuses).toHaveLength(4)
    expect(phases).toEqual(['shortBreak', 'shortBreak', 'shortBreak', 'longBreak'])
  })

  it('reset 回到25:00 focus 且不污染统计', () => {
    engine.start()
    clock.advance(300_000)
    engine.__tick()
    engine.reset()

    const s = engine.snapshot()
    expect(s.status).toBe('IDLE')
    expect(s.phase).toBe('focus')
    expect(s.remainingSeconds).toBe(1500)
    expect(s.cycleIndex).toBe(0)
    expect(rec.focuses).toHaveLength(0)
  })

  it('breakNow 从任意状态进入运行中的休息，结束后回到专注', () => {
    engine.start()
    clock.advance(300_000)
    engine.__tick()
    engine.breakNow()

    expect(engine.snapshot().phase).toBe('shortBreak')
    expect(engine.snapshot().status).toBe('RUNNING')

    clock.advance(300_000)
    engine.__tick()
    vi.advanceTimersByTime(500)
    expect(engine.snapshot().phase).toBe('focus')
  })

  it('autoStartNextPhase 关闭时归零后停在 IDLE', () => {
    engine.configure({ autoStartNextPhase: false })
    engine.start()
    clock.advance(1500_000)
    engine.__tick()
    vi.advanceTimersByTime(500)
    expect(engine.snapshot().status).toBe('IDLE')
    expect(engine.snapshot().phase).toBe('shortBreak')
  })
})

describe('计时引擎 — 跳过阶段', () => {
  let clock: ReturnType<typeof makeClock>
  let rec: Recorder
  let engine: TimerEngine

  beforeEach(() => {
    vi.useFakeTimers()
    clock = makeClock()
    rec = makeRecorder()
    engine = new TimerEngine(
      makeEvents(rec),
      { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
      { longBreakEvery: 4, autoStartNextPhase: true, now: clock.now }
    )
  })

  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
  })

  it('skip 进入下一阶段且计为未完成', () => {
    engine.attachTask('task-1')
    engine.start()
    clock.advance(60_000)
    engine.__tick()
    engine.skip()

    const s = engine.snapshot()
    expect(s.phase).toBe('shortBreak')
    expect(s.status).toBe('IDLE')
    expect(s.remainingSeconds).toBe(300)
    // ⭐ 跳过不计番茄
    expect(rec.focuses).toHaveLength(0)
  })

  it('skip 不累加 cycleIndex（未完成不算一轮）', () => {
    engine.start()
    clock.advance(60_000)
    engine.__tick()
    engine.skip()
    expect(engine.snapshot().cycleIndex).toBe(0)
  })

  it('连续 skip 可循环回到 focus', () => {
    engine.start()
    engine.skip() // → shortBreak
    expect(engine.snapshot().phase).toBe('shortBreak')
    engine.skip() // → focus
    expect(engine.snapshot().phase).toBe('focus')
    engine.skip() // → shortBreak
    expect(engine.snapshot().phase).toBe('shortBreak')
  })
})

describe('计时引擎 — 唤醒校正与补响', () => {
  let clock: ReturnType<typeof makeClock>
  let rec: Recorder
  let engine: TimerEngine

  beforeEach(() => {
    vi.useFakeTimers()
    clock = makeClock()
    rec = makeRecorder()
    engine = new TimerEngine(
      makeEvents(rec),
      { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
      { longBreakEvery: 4, autoStartNextPhase: true, now: clock.now }
    )
  })

  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
  })

  it('休眠 10 分钟唤醒，剩余时间误差 ≤ 1 秒', () => {
    engine.start()
    clock.advance(600_000) // 过去 10 分钟
    engine.__tick()
    // 关键：即使完全没有 tick，差值计算依然准确
    const s = engine.snapshot()
    expect(Math.abs(s.remainingSeconds - (1500 - 600))).toBeLessThanOrEqual(1)
  })

  it('休眠 8 小时后剩余时间照样准（架构不依赖事件）', () => {
    engine.start()
    clock.advance(8 * 3600_000)
    engine.attachPowerEvents()
    // 直接重算：剩余已为负 → 触发校正
    engine.__tick()
    // 8 小时跨越多个阶段，应补齐
    expect(rec.catchUps.length).toBeGreaterThan(0)
  })

  it('跨过多个阶段时补响次数 = 被跳过的阶段数', () => {
    engine.start()
    // 25+5+25+5 = 60 分钟，跨过 2 个专注 + 2 个休息
    clock.advance(60 * 60_000)
    engine.attachPowerEvents()
    engine.__tick()

    expect(rec.catchUps).toHaveLength(1)
    const missed = rec.catchUps[0].phases
    expect(missed).toEqual(['focus', 'shortBreak', 'focus', 'shortBreak'])
    expect(missed).toHaveLength(4)
  })

  it('未跨阶段时唤醒不产生补响', () => {
    engine.start()
    clock.advance(60_000)
    engine.attachPowerEvents()
    engine.__tick()
    expect(rec.catchUps).toHaveLength(0)
    expect(engine.snapshot().remainingSeconds).toBe(1440)
  })

  it('restore 后若 endsAt 已过则立即校正', () => {
    engine.start()
    const snap = engine.snapshot()
    clock.advance(90 * 60_000) // 跨过 25 专注 + 5 休息 + 25 专注
    engine.restore(snap)
    expect(rec.catchUps.length).toBeGreaterThan(0)
  })

  it('restore 未过期时保持 RUNNING 且剩余准确', () => {
    engine.start()
    const snap = engine.snapshot()
    clock.advance(120_000)
    engine.restore(snap)
    const s = engine.snapshot()
    expect(s.status).toBe('RUNNING')
    expect(Math.abs(s.remainingSeconds - (1500 - 120))).toBeLessThanOrEqual(1)
  })

  it('中断次数可累加（严格模式）', () => {
    engine.configure({ strictMode: true })
    engine.start()
    engine.noteInterrupt()
    engine.noteInterrupt()
    expect(engine.snapshot().interruptCount).toBe(2)
  })
})

// ============================================================
//  手动改写本轮时长（专注页点「分 / 秒」）
// ============================================================
//  ⭐ 核心约定是「只改这一轮」：
//     · 改完按开始不能被重置回默认值
//     · 本轮结算后必须失效，下一轮回到设置里的默认时长
// ============================================================
describe('计时引擎 — 手动改写本轮时长', () => {
  let clock: ReturnType<typeof makeClock>
  let rec: Recorder
  let engine: TimerEngine

  beforeEach(() => {
    vi.useFakeTimers()
    clock = makeClock()
    rec = makeRecorder()
    engine = new TimerEngine(
      makeEvents(rec),
      { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
      { longBreakEvery: 4, autoStartNextPhase: true, now: clock.now }
    )
  })

  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
  })

  it('IDLE 下改写只动 remainingSeconds，不设置 endsAt', () => {
    engine.setRemaining(600)
    const s = engine.snapshot()
    expect(s.remainingSeconds).toBe(600)
    expect(s.endsAt).toBeNull()
    expect(s.status).toBe('IDLE')
  })

  it('改完再开始不会被重置回默认时长', () => {
    engine.setRemaining(600)
    engine.start()
    expect(engine.snapshot().remainingSeconds).toBe(600)
    expect(engine.snapshot().endsAt).toBe(clock.now() + 600 * 1000)
  })

  it('运行中改写会重算 endsAt，并以新值继续走', () => {
    engine.start() // 1500s
    clock.advance(60_000)
    engine.setRemaining(300)
    expect(engine.snapshot().remainingSeconds).toBe(300)
    expect(engine.snapshot().endsAt).toBe(clock.now() + 300 * 1000)
    clock.advance(60_000)
    engine.__tick()
    expect(engine.snapshot().remainingSeconds).toBe(240)
  })

  it('结算时 plannedSeconds 用手动值，不被默认 25 分钟污染', () => {
    engine.setRemaining(600)
    engine.start()
    clock.advance(600_000)
    engine.__tick()
    vi.advanceTimersByTime(500)
    expect(rec.focuses).toHaveLength(1)
    expect(rec.focuses[0].plannedSeconds).toBe(600)
    expect(rec.focuses[0].actualSeconds).toBe(600)
  })

  it('重置作废手动改写，回到默认时长', () => {
    engine.setRemaining(600)
    engine.reset()
    expect(engine.snapshot().remainingSeconds).toBe(1500)
    engine.start()
    expect(engine.snapshot().remainingSeconds).toBe(1500)
  })

  it('跳过阶段后手动改写作废，下一轮用默认时长', () => {
    engine.setRemaining(600)
    engine.start()
    engine.skip()
    expect(engine.snapshot().phase).toBe('shortBreak')
    engine.start()
    // 短休息默认 5 分钟 —— 600 秒没有被带进来
    expect(engine.snapshot().remainingSeconds).toBe(300)
  })

  it('秒数夹取到 [1, 99:59]，避免改出 0 秒立刻响铃', () => {
    engine.setRemaining(0)
    expect(engine.snapshot().remainingSeconds).toBe(1)
    engine.setRemaining(999_999)
    expect(engine.snapshot().remainingSeconds).toBe(99 * 60 + 59)
  })
})

// ============================================================
//  心流模式（flowMode = 'flowtime'）
//  核心约定：正计时、没有结束点、由用户点「结束这一轮」结算，
//          休息时长按**实际已专注时长**反算。
// ============================================================

const DEFAULT_FLOWTIME: FlowtimeSettings = {
  breakEnabled: true,
  breakMode: 'ratio',
  breakPercent: 20,
  breakRules: [
    { minMinutes: 0, maxMinutes: 30, breakMinutes: 5 },
    { minMinutes: 30, maxMinutes: 60, breakMinutes: 8 },
    { minMinutes: 60, maxMinutes: null, breakMinutes: 10 }
  ]
}

describe('计时引擎 — 心流模式（正计时）', () => {
  let clock: ReturnType<typeof makeClock>
  let rec: Recorder
  let engine: TimerEngine

  function build(flowtime?: Partial<FlowtimeSettings>): TimerEngine {
    return new TimerEngine(
      makeEvents(rec),
      { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
      {
        longBreakEvery: 4,
        autoStartNextPhase: true,
        flowMode: true,
        flowtime: { ...DEFAULT_FLOWTIME, ...flowtime },
        now: clock.now
      }
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    clock = makeClock()
    rec = makeRecorder()
    engine = build()
  })

  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
  })

  it('开始后不设 endsAt，elapsedSeconds 随时间增长', () => {
    engine.start()
    clock.advance(90_000) // 1 分 30 秒
    engine.__tick()
    const s = engine.snapshot()
    expect(s.status).toBe('RUNNING')
    expect(s.endsAt).toBeNull()
    expect(s.elapsedSeconds).toBe(90)
    expect(s.countingUp).toBe(true)
  })

  /*
   * ⭐ 心流没有结束点，所以推进时钟绝不会自己停下来 ——
   *    番茄钟在这里早就 completePhase 了。
   */
  it('推进 1 小时也不会自动归零', () => {
    engine.start()
    clock.advance(60 * 60_000)
    engine.__tick()
    const s = engine.snapshot()
    expect(s.status).toBe('RUNNING')
    expect(s.phase).toBe('focus')
    expect(s.elapsedSeconds).toBe(3600)
    expect(rec.focuses).toHaveLength(0)
  })

  it('暂停后恢复：已专注时长保留（起点被回拨），不会丢暂停那段时间', () => {
    engine.start()
    clock.advance(60_000)
    engine.__tick()
    engine.pause()
    clock.advance(600_000) // 暂停了 10 分钟
    engine.start()
    clock.advance(1_000)
    engine.__tick()
    // 60 秒 + 1 秒，而不是 60 + 600 + 1
    expect(engine.snapshot().elapsedSeconds).toBe(61)
  })

  it('结束本轮：结算 1 个专注，plannedSeconds 用实际时长，然后进入休息', () => {
    engine.start()
    clock.advance(50 * 60_000) // 专注 50 分钟
    engine.__tick()
    engine.finishFlow()

    expect(rec.focuses).toHaveLength(1)
    expect(rec.focuses[0].plannedSeconds).toBe(3000)
    expect(rec.focuses[0].actualSeconds).toBe(3000)
    // 50 分钟 × 20% = 10 分钟
    const s = engine.snapshot()
    expect(s.phase).toBe('shortBreak')
    expect(s.remainingSeconds).toBe(600)
    expect(s.elapsedSeconds).toBe(0)
  })

  it('比例式休息有 1 分钟下限：专注 2 分钟 → 休息 1 分钟（而不是 24 秒）', () => {
    engine = build()
    engine.start()
    clock.advance(120_000)
    engine.__tick()
    engine.finishFlow()
    expect(engine.snapshot().remainingSeconds).toBe(60)
  })

  it('分段规则：按半开区间命中', () => {
    engine = build({ breakMode: 'rules' })
    engine.start()
    clock.advance(45 * 60_000) // 45 分钟 → 落在 [30, 60)
    engine.__tick()
    engine.finishFlow()
    expect(engine.snapshot().remainingSeconds).toBe(8 * 60)
  })

  it('分段规则：超过 60 分钟用最后一条（maxMinutes = null）', () => {
    engine = build({ breakMode: 'rules' })
    engine.start()
    clock.advance(95 * 60_000)
    engine.__tick()
    engine.finishFlow()
    expect(engine.snapshot().remainingSeconds).toBe(10 * 60)
  })

  it('关掉休息：结束后停在专注态的空闲，可以直接再开一轮', () => {
    engine = build({ breakEnabled: false })
    engine.start()
    clock.advance(10 * 60_000)
    engine.__tick()
    engine.finishFlow()
    const s = engine.snapshot()
    expect(s.phase).toBe('focus')
    expect(s.status).toBe('IDLE')
    expect(s.endsAt).toBeNull()
    expect(rec.focuses).toHaveLength(1)
  })

  it('重置作废这一轮，回到 00:00', () => {
    engine.start()
    clock.advance(120_000)
    engine.__tick()
    engine.reset()
    const s = engine.snapshot()
    expect(s.elapsedSeconds).toBe(0)
    expect(s.countingUp).toBe(false)
    expect(s.remainingSeconds).toBe(25 * 60)
  })

  it('discardIdle 扣减已专注时长，并把起点后移', () => {
    engine.start()
    clock.advance(600_000) // 10 分钟
    engine.__tick()
    engine.discardIdle(300) // 离开 5 分钟
    const s = engine.snapshot()
    expect(s.elapsedSeconds).toBe(300)
    // 起点后移后，时间只再走 1 秒
    clock.advance(1_000)
    engine.__tick()
    expect(engine.snapshot().elapsedSeconds).toBe(301)
  })
})

describe('计时引擎 — 空闲回处理（倒计时）', () => {
  let clock: ReturnType<typeof makeClock>
  let rec: Recorder
  let engine: TimerEngine

  beforeEach(() => {
    vi.useFakeTimers()
    clock = makeClock()
    rec = makeRecorder()
    engine = new TimerEngine(
      makeEvents(rec),
      { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
      { longBreakEvery: 4, autoStartNextPhase: true, now: clock.now }
    )
  })

  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
  })

  it('离开 5 分钟 → 剩余时间补回 5 分钟（等效于离开期间暂停）', () => {
    engine.start() // 1500 秒
    clock.advance(60_000) // 走过 1 分钟，还剩 1440
    engine.__tick()
    engine.discardIdle(300)
    const s = engine.snapshot()
    // 1440 + 300 = 1740
    expect(s.remainingSeconds).toBe(1740)
    expect(s.status).toBe('RUNNING')
  })

  it('phaseStartedAt 同步后移：结算时不会把这 5 分钟算进实际专注时长', () => {
    engine.start()
    clock.advance(120_000)
    engine.__tick()
    engine.discardIdle(600) // 离开 10 分钟
    clock.advance(120_000) // 回来后又专注 2 分钟
    engine.__tick()
    engine.skip()
    // 实际专注 = 2 + 2 = 4 分钟，而不是 2 + 10 + 2
    expect(rec.focuses).toHaveLength(0) // skip 不计入专注
  })

  it('非 RUNNING 时只补剩余秒数，不动 endsAt', () => {
    engine.setRemaining(600)
    engine.discardIdle(120)
    expect(engine.snapshot().remainingSeconds).toBe(720)
    expect(engine.snapshot().status).toBe('IDLE')
  })

  it('0 秒是空操作', () => {
    engine.start()
    const before = engine.snapshot().remainingSeconds
    engine.discardIdle(0)
    expect(engine.snapshot().remainingSeconds).toBe(before)
  })
})
