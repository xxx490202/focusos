/**
 * ============================================================
 *  gen-assets.mjs — 构建期资源生成（零依赖，纯 Node）
 * ============================================================
 *  产出：
 *    build/icon.png1024×1024 应用图标唯一源图
 *               （.icns / .ico 由 electron-builder 构建时自动生成）
 *    build/trayTemplate.png          macOS 菜单栏 Template 变体（黑+alpha）
 *    build/trayWin-light.png         Windows 托盘浅色版（深色主题时使用）
 *    build/trayWin-dark.png          Windows 托盘深色版（浅色主题时使用）
 *    resources/sounds/chime.wav      两平台统一提示音（禁止依赖系统音）
 *
 *  ⚠️ 本脚本只在构建期运行，不进入应用包，不含任何原生模块。
 *     渲染层处理背景图一律走 CSS（object-fit / filter / gradient），
 *     绝不在运行时调用任何外部图像命令。
 * ============================================================
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ============================================================
//  1. 极简 PNG 编码器（RGBA8，无外部依赖）
// ============================================================

function crc32(buf) {
  let c
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })())
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** rgba: Uint8ClampedArray 长度 = w*h*4 */
function encodePng(rgba, w, h) {
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ============================================================
//  2. 有向距离场（SDF）光栅化 —— 解析式抗锯齿，任何尺寸都清晰
// ============================================================

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** 距离 d（像素）→覆盖率，1px 宽过渡带 */
const cov = (d) => clamp01(0.5 - d)

const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r

const sdEllipse = (x, y, cx, cy, rx, ry) => {
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry
  const k = Math.hypot(dx, dy)
  return (k - 1) * Math.min(rx, ry)
}

const sdRing = (x, y, cx, cy, r, half) => Math.abs(Math.hypot(x - cx, y - cy) - r) - half

/** 超椭圆（squircle）—— macOS 图标轮廓 */
const sdSquircle = (x, y, cx, cy, half, n) => {
  const dx = Math.abs(x - cx) / half
  const dy = Math.abs(y - cy) / half
  return (Math.pow(dx, n) + Math.pow(dy, n) - 1) * half
}

/** 旋转椭圆（番茄萼片叶片） */
const sdEllipseRot = (x, y, cx, cy, rx, ry, rot) => {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const dx = x - cx
  const dy = y - cy
  const lx = (dx * c + dy * s) / rx
  const ly = (-dx * s + dy * c) / ry
  return (Math.hypot(lx, ly) - 1) * Math.min(rx, ry)
}

/** 从正上方顺时针的弧段覆盖：angFrom/angTo 单位为「圈的比例」 */
function arcCoverage(x, y, cx, cy, r, half, fromTurns, toTurns) {
  const ring = cov(sdRing(x, y, cx, cy, r, half))
  if (ring <= 0) return 0
  // 0 在正上方，顺时针为正
  let ang = Math.atan2(x - cx, -(y - cy)) / (Math.PI * 2)
  if (ang < 0) ang += 1
  const lo = Math.min(fromTurns, toTurns)
  const hi = Math.max(fromTurns, toTurns)
  const eps = 1 / (Math.PI * 2 * r)
  let inRange
  if (ang >= lo && ang <= hi) inRange = 1
  else {
    const dLo = Math.min(Math.abs(ang - lo), 1 - Math.abs(ang - lo))
    const dHi = Math.min(Math.abs(ang - hi), 1 - Math.abs(ang - hi))
    inRange = clamp01(0.5 - Math.min(dLo, dHi) / eps)
  }
  return ring * inRange
}

// ---- 颜色工具 ----
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
]

function over(dst, i, rgb, alpha) {
  if (alpha <= 0) return
  const a = clamp01(alpha)
  const da = dst[i + 3] / 255
  const outA = a + da * (1 - a)
  if (outA <= 0) return
  for (let k = 0; k < 3; k++) {
    dst[i + k] = Math.round((rgb[k] * a + dst[i + k] * da * (1 - a)) / outA)
  }
  dst[i + 3] = Math.round(outA * 255)
}


// ============================================================
//  2. 提示音 chime.wav —— 两平台必须完全一致，禁止依赖系统音
//     手工合成大三和弦钟声：基频 + 泛音 + 指数衰减 + 软起音
// ============================================================
function renderChime() {
  const sampleRate = 44100
  const duration = 1.7
  const n = Math.floor(sampleRate * duration)
  const data = new Float64Array(n)

  // 两击：A5 然后 E6（大三度上方），像风铃
  const strikes = [
    { at: 0.0, f: 880.0, gain: 1.0, decay: 0.62 },
    { at: 0.16, f: 1318.51, gain: 0.72, decay: 0.78 }
  ]
  const partials = [
    { m: 1, g: 1.0 },
    { m: 2.0, g: 0.42 },
    { m: 3.01, g: 0.2 },
    { m: 4.98, g: 0.1 }
  ]

  for (const s of strikes) {
    const start = Math.floor(s.at * sampleRate)
    for (let i = start; i < n; i++) {
      const t = (i - start) / sampleRate
      let v = 0
      for (const p of partials) {
        v += p.g * Math.sin(2 * Math.PI * s.f * p.m * t)
      }
      // 软起音 6ms，避免咔哒声
      const attack = Math.min(1, t / 0.006)
      data[i] += v * s.gain * attack * Math.exp(-t / s.decay)
    }
  }

  // 归一化 + 末尾淡出
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]))
  const norm = peak > 0 ? 0.72 / peak : 1
  const fadeFrom = Math.floor((duration - 0.18) * sampleRate)
  const pcm = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    let v = data[i] * norm
    if (i > fadeFrom) v *= (n - i) / (n - fadeFrom)
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2)
  }

  const header = Buffer.alloc(44)
  const dataSize = pcm.length
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16) // PCM fmt chunk size
  header.writeUInt16LE(1, 20) // format = PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcm])
}

// ============================================================
//  3. 写出
// ============================================================
function write(rel, buf) {
  const p = join(ROOT, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, buf)
  const kb = (buf.length / 1024).toFixed(1)
  console.log(`  ✓ ${rel.padEnd(38)} ${kb.padStart(9)} KB`)
}

console.log('FocusOS 资源生成中…')
// 注意：build/icon.png 是用户提供的 FocusOS.icns 提取而来，
// 由 scripts/extract-icon.mjs 单独生成，本脚本绝不覆盖它。
// 托盘图标与该标记保持同一视觉语言。
write('resources/sounds/chime.wav', renderChime())
console.log('完成。托盘图标由 scripts/gen-tray.mjs 从 build/icon.png 派生。')
