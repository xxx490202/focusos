// ============================================================
//  useFocusSound.ts — 专注进行中的环境音（滴答 / 白噪音）
// ============================================================
//  ⭐ 全部用 Web Audio **现场合成**，不引入任何音频素材：
//    · 白噪音 = 一段循环的随机噪声（低通后接近风扇声 / 雨声）
//    · 滴答   = 一段**一秒长的循环缓冲**，里面刻了「嘀」「嗒」两声
//    好处是产物里不用多带 mp3/wav，也不用为多端打包考虑音频格式。
//
//  ⚠️ 三条纪律：
//    1. **只在真正需要时才建 AudioContext** —— 用户把音效设为「关闭」时
//       不该白占一个音频上下文（有些平台会因此让系统显示「正在播放音频」）。
//    2. 暂停 / 进入休息 / 停止时**必须立刻静音**，否则用户按下暂停，
//       滴答还在响，会以为按钮坏了。
//    3. **声音一律交给音频线程循环，不用 setInterval 发声** —— 见 tickBuffer 的注释。
// ============================================================
import { useEffect, useRef } from 'react'
import type { FocusSound } from '@shared/types'
// 波形合成是纯算术，放在 shared 下才能被 vitest 直接单测（详见该文件头注释）
import { renderClick } from '@shared/tick-synth'

/** 白噪音缓冲时长（秒）。太短会听出循环接缝，2 秒足够且只占几百 KB */
const NOISE_SECONDS = 2
/** 白噪音低通：砍掉刺耳的高频，久听不累 */
const NOISE_LOWPASS_HZ = 1200

// ---------------- 滴答 ----------------
/*
 * ⭐ 滴答为什么不用 setInterval：
 *   早先是「每秒 setInterval 发一声 40ms 的噪声」，实测下来听感很糟 ——
 *   一声只有 40ms、间隔却有 1000ms，占空比 4%，
 *   听上去就是「嗒 ……（空）…… 嗒 ……（空）」，用户反馈「不连贯，间隔很长时间的滴答」。
 *   而且渲染进程的定时器一旦被节流或主线程被占满，间隔还会更飘。
 *
 *   现在改成：**一段 1 秒长的缓冲里刻好「嘀」「嗒」两声，交给音频线程 loop 播放**。
 *   音频线程按采样率自己推进，与 JS 定时器完全无关：
 *     · 节奏恒定，不受节流 / 主线程卡顿影响
 *     · 每秒只占几十 KB 内存，CPU 几乎为零（不再每秒新建节点连线）
 */
/** 循环周期：1 秒一轮，与钟表一致 */
const TICK_LOOP_SECONDS = 1
/** 「嘀」的位置（秒） */
const TICK_A_AT = 0
/** 「嗒」的位置（秒）—— 半秒一声，才是「滴答滴答」而不是「嗒…嗒…」 */
const TICK_B_AT = 0.5
const TICK_A_HZ = 2900 // 嘀：略亮
const TICK_B_HZ = 2250 // 嗒：略闷，与嘀形成交替
const TICK_A_PEAK = 0.95
const TICK_B_PEAK = 0.72 // 嗒轻一点，像真钟摆

/** 噪声缓冲按 AudioContext 缓存：白噪音 2 秒 + 滴答 1 秒，都只生成一次 */
let noiseCache: { ctx: AudioContext; buffer: AudioBuffer } | null = null
let tickCache: { ctx: AudioContext; buffer: AudioBuffer } | null = null

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseCache && noiseCache.ctx === ctx) return noiseCache.buffer
  const len = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noiseCache = { ctx, buffer: buf }
  return buf
}

/** 一秒长的滴答循环：0.0s 一声「嘀」，0.5s 一声「嗒」 */
function tickBuffer(ctx: AudioContext): AudioBuffer {
  if (tickCache && tickCache.ctx === ctx) return tickCache.buffer
  const sr = ctx.sampleRate
  const buf = ctx.createBuffer(1, Math.max(1, Math.round(sr * TICK_LOOP_SECONDS)), sr)
  const data = buf.getChannelData(0)
  renderClick(data, Math.round(sr * TICK_A_AT), sr, TICK_A_HZ, 0x9e3779b9, TICK_A_PEAK)
  renderClick(data, Math.round(sr * TICK_B_AT), sr, TICK_B_HZ, 0x85ebca6b, TICK_B_PEAK)
  tickCache = { ctx, buffer: buf }
  return buf
}

/**
 * @param mode   设置里的 focusSound
 * @param volume 0–1
 * @param active 是否应该发声（专注阶段 + 计时在跑）
 */
export function useFocusSound(mode: FocusSound, volume: number, active: boolean): void {
  const ctxRef = useRef<AudioContext | null>(null)
  const masterRef = useRef<GainNode | null>(null)

  // ---- 图构建：只依赖「模式 + 是否该响」 ----
  useEffect(() => {
    if (!active || mode === 'off') return

    let ctx = ctxRef.current
    if (!ctx) {
      ctx = new AudioContext()
      ctxRef.current = ctx
    }

    /*
     * 系统或浏览器可能把上下文挂起（睡眠唤醒、还没有用户手势时常见）。
     * ⚠️ 挂起时 currentTime 是**冻住**的，后面排的声部全都堆在同一个时刻，
     *    听起来就是「很久才响一声」—— 所以这里不只要 resume 一次，
     *    还要在窗口重新可见 / 重新聚焦时再补一次。
     */
    const ensureRunning = (): void => {
      if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    }
    ensureRunning()
    document.addEventListener('visibilitychange', ensureRunning)
    window.addEventListener('focus', ensureRunning)

    const master = ctx.createGain()
    master.gain.value = volume
    master.connect(ctx.destination)
    masterRef.current = master

    let src: AudioBufferSourceNode | null = null

    if (mode === 'whiteNoise') {
      src = ctx.createBufferSource()
      src.buffer = noiseBuffer(ctx)
      src.loop = true
      /*
       * 低通一下：纯白噪音的高频很刺耳，长时间听会累。
       * 砍到 1.2kHz 之后接近「风扇声 / 雨声」，适合久听。
       */
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = NOISE_LOWPASS_HZ
      src.connect(lp)
      lp.connect(master)
    } else {
      src = ctx.createBufferSource()
      src.buffer = tickBuffer(ctx)
      src.loop = true
      src.connect(master)
    }
    src.start()

    return () => {
      document.removeEventListener('visibilitychange', ensureRunning)
      window.removeEventListener('focus', ensureRunning)
      try {
        src?.stop()
      } catch {
        // 已经停过就忽略
      }
      master.disconnect()
      masterRef.current = null
    }
    // volume 刻意不进依赖：拖动音量滑块时重建整张图会「咔咔」断音，
    // 音量由下面那个 effect 直接改 gain 值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, active])

  // ---- 音量热更新 ----
  useEffect(() => {
    const master = masterRef.current
    if (master) master.gain.value = volume
  }, [volume])

  // ---- 卸载时释放音频上下文 ----
  useEffect(() => {
    return () => {
      void ctxRef.current?.close().catch(() => undefined)
      ctxRef.current = null
      noiseCache = null
      tickCache = null
    }
  }, [])
}
