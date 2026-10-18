// ============================================================
//  focus-sound.test.ts — 滴答合成（纯函数，不需要 AudioContext）
// ============================================================
//  这里测的是「一秒循环缓冲里那两声」的波形本身：
//    · 位置对不对（0.0s / 0.5s）
//    · 响度对不对（归一化到目标峰值，不随采样率漂移）
//    · 两声之间必须是**静音**（否则就成了白噪音，不是滴答）
//  声音由音频线程循环播放，节奏恒定 —— 见 useFocusSound.ts。
// ============================================================
import { describe, it, expect } from 'vitest'
import { renderClick } from '../src/shared/tick-synth'

const SR = 44100

/** 一段区间内的峰值 / RMS */
function stats(buf: Float32Array, from: number, to: number) {
  let peak = 0
  let sum = 0
  for (let i = from; i < to; i++) {
    const a = Math.abs(buf[i])
    if (a > peak) peak = a
    sum += buf[i] * buf[i]
  }
  const n = Math.max(1, to - from)
  return { peak, rms: Math.sqrt(sum / n) }
}

/** 刻出一秒的滴答循环，和 useFocusSound 里的一模一样 */
function tickLoop(sampleRate = SR): Float32Array {
  const buf = new Float32Array(sampleRate)
  renderClick(buf, 0, sampleRate, 2900, 0x9e3779b9, 0.95)
  renderClick(buf, Math.round(sampleRate * 0.5), sampleRate, 2250, 0x85ebca6b, 0.72)
  return buf
}

describe('renderClick — 单声合成', () => {
  it('在指定位置刻出一声，峰值归一化到目标值', () => {
    const buf = new Float32Array(SR)
    renderClick(buf, 0, SR, 2900, 123, 0.9)
    expect(stats(buf, 0, SR).peak).toBeCloseTo(0.9, 2)
  })

  it('落在缓冲中间也能准确定位', () => {
    const buf = new Float32Array(SR)
    const at = Math.round(SR * 0.5)
    renderClick(buf, at, SR, 2250, 456, 0.6)
    // 起点之前是静音
    expect(stats(buf, 0, at - 1).peak).toBe(0)
    // 起点之后马上有声
    expect(stats(buf, at, at + 200).peak).toBeGreaterThan(0.1)
  })

  it('一声只有几十毫秒，不是长音', () => {
    const buf = new Float32Array(SR)
    renderClick(buf, 0, SR, 2900, 789, 0.9)
    const head = stats(buf, 0, Math.round(SR * 0.03))
    const tail = stats(buf, Math.round(SR * 0.08), SR)
    expect(head.rms).toBeGreaterThan(0.01)
    // 80ms 之后必须已经衰减干净
    expect(tail.peak).toBeLessThan(0.01)
  })

  it('同一个种子 → 完全一样的波形（钟摆每一声都该一致）', () => {
    const a = new Float32Array(4096)
    const b = new Float32Array(4096)
    renderClick(a, 0, SR, 2900, 42, 0.9)
    renderClick(b, 0, SR, 2900, 42, 0.9)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('不同种子 → 不同波形', () => {
    const a = new Float32Array(4096)
    const b = new Float32Array(4096)
    renderClick(a, 0, SR, 2900, 1, 0.9)
    renderClick(b, 0, SR, 2900, 999, 0.9)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  it('音量不随采样率漂移（44.1k 与 48k 峰值一致）', () => {
    const a = new Float32Array(44100)
    const b = new Float32Array(48000)
    renderClick(a, 0, 44100, 2900, 7, 0.8)
    renderClick(b, 0, 48000, 2900, 7, 0.8)
    expect(stats(a, 0, a.length).peak).toBeCloseTo(0.8, 2)
    expect(stats(b, 0, b.length).peak).toBeCloseTo(0.8, 2)
  })

  it('写入位置超出缓冲时截断，不越界', () => {
    const buf = new Float32Array(100)
    expect(() => renderClick(buf, 90, SR, 2900, 1, 0.9)).not.toThrow()
    expect(buf.length).toBe(100)
  })
})

describe('tickLoop — 一秒「滴答」循环缓冲', () => {
  it('0.0s 一声「嘀」、0.5s 一声「嗒」', () => {
    const buf = tickLoop()
    expect(stats(buf, 0, Math.round(SR * 0.03)).peak).toBeCloseTo(0.95, 2)
    expect(stats(buf, Math.round(SR * 0.5), Math.round(SR * 0.53)).peak).toBeCloseTo(0.72, 2)
  })

  it('两声之间是静音 —— 否则听着就是白噪音而不是钟摆', () => {
    const buf = tickLoop()
    const gap = stats(buf, Math.round(SR * 0.08), Math.round(SR * 0.45))
    expect(gap.peak).toBeLessThan(0.001)
    const tail = stats(buf, Math.round(SR * 0.58), SR)
    expect(tail.peak).toBeLessThan(0.001)
  })

  it('每秒两声，节奏是 0.5 秒一次', () => {
    const buf = tickLoop()
    const a = stats(buf, 0, Math.round(SR * 0.03)).peak
    const b = stats(buf, Math.round(SR * 0.5), Math.round(SR * 0.53)).peak
    // 「嗒」比「嘀」轻，形成交替感
    expect(b).toBeLessThan(a)
    // 循环首尾相接处不留缝：最后 3ms 是静音，下一轮开头才是「嘀」
    expect(stats(buf, SR - 3 * 44, SR).peak).toBeLessThan(0.001)
  })

  it('整段缓冲的响度足够听见（RMS 高于 0.005）', () => {
    const buf = tickLoop()
    expect(stats(buf, 0, SR).rms).toBeGreaterThan(0.005)
  })
})
