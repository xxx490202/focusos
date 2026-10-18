// ============================================================
//  tick-synth.ts — 钟表「滴答」声的波形合成（纯函数）
// ============================================================
//  ⭐ 为什么要单独放一个文件、而且放在 shared 下：
//    · 这里**只做算术**：往一段 Float32Array 里写采样点，不碰 Web Audio、
//      不碰 DOM、不碰 Electron ——
//    · tsconfig.node.json 只把 src/shared 与 tests 收进工程，
//      所以放在这里才能被 vitest 直接单测（渲染器的文件不在那个工程里，
//      从测试里 import 会报 TS6307 / 找不到 AudioContext）。
//
//  用法见 renderer/src/hooks/useFocusSound.ts：
//    一段 1 秒的缓冲里刻好「嘀」「嗒」两声，交给音频线程 loop 播放。
// ============================================================

/** 一声的时长（秒）。再长就不像钟摆，像敲门 */
export const CLICK_SECONDS = 0.03
/** 包络衰减时间常数（秒） */
const CLICK_DECAY_TAU = 0.007
/** 带通尖锐度。越高越「嘀」，越低越「噗」 */
const CLICK_Q = 4.5

/**
 * 把一声短促的「嗒」写进缓冲。
 *
 * 合成链路：确定性白噪 × 指数衰减包络 → 二阶状态变量带通（Chamberlin SVF）。
 * 用带通而不是直接播噪声，是因为宽频噪声听着像「沙」，
 * 只有把能量聚到 2~3kHz 一带，才像钟摆敲出来的那一声。
 *
 * @param out         目标缓冲（**叠加**写入，不覆盖原有内容）
 * @param startSample 写入起点（采样点下标）
 * @param sampleRate  采样率
 * @param freq        这一声的中心频率（Hz）
 * @param seed        噪声种子：同一个种子 → 完全一样的波形
 * @param peak        归一化后的峰值（0–1）
 */
export function renderClick(
  out: Float32Array,
  startSample: number,
  sampleRate: number,
  freq: number,
  seed: number,
  peak: number
): void {
  const n = Math.min(Math.round(CLICK_SECONDS * sampleRate), out.length - startSample)
  if (n <= 0) return

  const rng = makeRng(seed)
  const f = 2 * Math.sin((Math.PI * freq) / sampleRate)
  const damp = 1 / CLICK_Q
  let low = 0
  let band = 0
  const tmp = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-i / (sampleRate * CLICK_DECAY_TAU))
    const high = rng() * env - low - damp * band
    band += f * high
    low += f * band
    tmp[i] = band
  }

  /*
   * 归一化到目标峰值。
   * ⚠️ 必须做：SVF 的输出幅度随 Q、采样率、噪声序列漂移，
   *    不归一化的话换个设备音量就差好几倍（实测峰值 0.05~0.4 都出现过）。
   */
  let max = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(tmp[i])
    if (a > max) max = a
  }
  const k = max > 0 ? peak / max : 0
  for (let i = 0; i < n; i++) out[startSample + i] += tmp[i] * k
}

/**
 * 确定性伪随机（xorshift32）。
 * ⭐ 刻意不用 Math.random()：钟摆每一声都该一样，
 *    而且固定种子后单测才能断言出确切的波形。
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return (s / 0xffffffff) * 2 - 1
  }
}
