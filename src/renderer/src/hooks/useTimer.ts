// ============================================================
//  useTimer.ts — 计时状态订阅
// ============================================================
//  ⭐ 计时状态只在主进程持有，渲染层纯订阅，绝不自行递减。
// ============================================================
import { useEffect, useState, useRef } from 'react'
import type { TimerState } from '@shared/types'
import { defaultSettings } from '@shared/defaults'

const IDLE: TimerState = {
  phase: 'focus',
  status: 'IDLE',
  taskId: null,
  endsAt: null,
  remainingSeconds: defaultSettings().durations.workMinutes * 60,
  elapsedSeconds: 0,
  countingUp: false,
  cycleIndex: 0,
  phaseStartedAt: null,
  strictMode: false,
  interruptCount: 0
}

export function useTimer() {
  const [timer, setTimer] = useState<TimerState>(IDLE)
  const timerRef = useRef(timer)
  timerRef.current = timer

  useEffect(() => {
    let cancelled = false

    // 首次拉取权威状态
    void window.api.timer.get().then((r) => {
      if (cancelled) return
      if (r.ok) setTimer(r.data)
    })

    // 订阅主进程推送
    const offTick = window.api.on('timer:tick', (payload) => {
      if (cancelled) return
      setTimer(payload as TimerState)
    })

    return () => {
      cancelled = true
      offTick()
    }
  }, [])

  const call = async (fn: () => Promise<{ ok: true; data: TimerState } | { ok: false; error: string }>) => {
    const r = await fn()
    if (r.ok) setTimer(r.data)
    return r
  }

  return {
    timer,
    start: () => call(() => window.api.timer.start()),
    pause: () => call(() => window.api.timer.pause()),
    reset: () => call(() => window.api.timer.reset()),
    skip: () => call(() => window.api.timer.skip()),
    breakNow: () => call(() => window.api.timer.break()),
    /**
     * 手动设定本轮倒计时（专注页点分/秒）。
     * 只影响当前这一轮，不会写回设置。
     */
    setDuration: (seconds: number) => call(() => window.api.timer.setDuration(seconds)),
    /** 心流模式：结束本轮专注，按配置反算休息时长 */
    finishFlow: () => call(() => window.api.timer.finishFlow()),
    attachTask: (id: string | null) => call(() => window.api.timer.attachTask(id)),
    isRunning: timer.status === 'RUNNING',
    isPaused: timer.status === 'PAUSED',
    isFocus: timer.phase === 'focus',
    isBreak: timer.phase !== 'focus'
  }
}
