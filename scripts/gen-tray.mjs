/**
 * ============================================================
 *  gen-tray.mjs — 从应用图标派生托盘/菜单栏图标
 * ============================================================
 *  直接解码 build/icon.png（用户提供的 FocusOS.icns 提取物），
 *  按box-filter 降采样出各平台所需尺寸，保证与App 图标完全一致。
 *
 *  产物：
 *    build/trayTemplate.png   macOS 菜单栏 Template 变体
 *                             浅色区（白方框）→ 不透明，深色区（W 标记）→ 透明
 *                             系统 setTemplateImage(true) 自动反色，
 *                             深色菜单栏上呈「白方框 + 镂空 W」
 *    build/trayWin-light.png  Windows 托盘浅色版（深色任务栏时使用）
 *    build/trayWin-dark.png   Windows 托盘深色版（浅色任务栏时使用）
 *
 *  ⚠️ 纯 Node 实现：自带 PNG 解码（zlib inflate + 反滤波），
 *     不调用 sips / ImageMagick，不引入原生模块。
 * ============================================================
 */
import { inflateSync, deflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ============================================================
//  1. PNG 解码（仅支持 8bit RGB/RGBA，够用即可）
// ============================================================

function decodePng(buf) {
  if (buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error('缺少 IHDR')
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  const bitDepth = buf[24]
  const colorType = buf[25]
  if (bitDepth !== 8) throw new Error(`仅支持 8bit，实际 ${bitDepth}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (channels === 0) throw new Error(`仅支持 RGB/RGBA，colorType=${colorType}`)

  // 收集 IDAT
  const parts = []
  let offset = 8
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    if (type === 'IDAT') parts.push(buf.subarray(offset + 8, offset + 8 + len))
    if (type === 'IEND') break
    offset += 12 + len
  }
  const raw = inflateSync(Buffer.concat(parts))

  // 反滤波
  const bpp = channels
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const row = raw.subarray(pos, pos + stride)
    pos += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = row[x]
      switch (filter) {
        case 0: break
        case 1: v += a; break
        case 2: v += b; break
        case 3: v += (a + b) >> 1; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
        default: throw new Error(`未知滤波器 ${filter}`)
      }
      cur[x] = v & 0xff
    }
  }

  // 统一成 RGBA
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = out[i * bpp]
    rgba[i * 4 + 1] = out[i * bpp + 1]
    rgba[i * 4 + 2] = out[i * bpp + 2]
    rgba[i * 4 + 3] = bpp === 4 ? out[i * bpp + 3] : 255
  }
  return { width, height, rgba }
}

// ============================================================
//  2. PNG 编码
// ============================================================

let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
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

function encodePng(rgba, w, h) {
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw, y * (stride + 1) + 1
    )
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ============================================================
//  3. 降采样 + 变体
// ============================================================

/**
 * 求源图的不透明内容包围盒。
 *
 * ⚠️ 应用图标（.icns 提取物）四周自带很宽的安全边距 —— 实测内容只占
 *    画布的约 80%。若直接整体缩放，托盘图标会明显偏小；
 *    必须先裁掉这层边距，图形才能填满目标画布。
 */
function trimBox(src, sw) {
  let x0 = sw, y0 = sw, x1 = -1, y1 = -1
  for (let y = 0; y < sw; y++) {
    for (let x = 0; x < sw; x++) {
      if (src[(y * sw + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: sw, h: sw }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * box-filter 面积平均降采样：把源图的 rect 区域映射到 size×size。
 * @param src  源 RGBA
 * @param sw   源宽度（正方形）
 * @param rect 源坐标系下的采样区域
 * @param size 目标边长
 */
function resampleRect(src, sw, rect, size) {
  const dst = new Uint8ClampedArray(size * size * 4)
  const sxScale = rect.w / size
  const syScale = rect.h / size

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0
      const sx0 = rect.x + Math.floor(x * sxScale)
      const sx1 = Math.min(sw, rect.x + Math.ceil((x + 1) * sxScale))
      const sy0 = rect.y + Math.floor(y * syScale)
      const sy1 = Math.min(sw, rect.y + Math.ceil((y + 1) * syScale))
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * sw + sx) * 4
          const al = src[i + 3] / 255
          // 预乘后再平均，避免边缘透明像素把颜色拉灰
          r += src[i] * al
          g += src[i + 1] * al
          b += src[i + 2] * al
          a += src[i + 3]
          n++
        }
      }
      const o = (y * size + x) * 4
      const avgA = n === 0 ? 0 : a / n
      if (avgA <= 0.5) continue // 全透明
      const un = avgA / 255
      dst[o] = r / n / un
      dst[o + 1] = g / n / un
      dst[o + 2] = b / n / un
      dst[o + 3] = avgA
    }
  }
  return dst
}

/**
 * ⭐ 把源图标「缩小后居中放置」在透明画布里，四周留出真实透明边距。
 *
 * 为什么必须这样：
 *   应用图标是铺满画布的白色圆角方。若把它直接缩到画布尺寸，
 *   白方框会顶满画布边缘；而 macOS 菜单栏按 NSImage 的 pt 尺寸渲染，
 *   画布多大就画多大 → 图标撑爆菜单栏。
 *   真正的解法是让「图形本身」只占画布的 fill 比例，四周是透明像素，
 *   视觉尺寸才与其他系统菜单栏图标一致。
 *
 * @param src  源 RGBA（整幅图标）
 * @param sw   源宽度（正方形）
 * @param size 画布尺寸（像素）
 * @param fill 图形占画布的比例（0–1），先自动裁掉源图边距再套用
 */
function compose(src, sw, size, fill) {
  const box = trimBox(src, sw)
  const glyph = Math.max(1, Math.round(size * fill))
  const pad = Math.floor((size - glyph) / 2)
  const small = resampleRect(src, sw, box, glyph)

  const canvas = new Uint8ClampedArray(size * size * 4) // 默认全透明
  for (let y = 0; y < glyph; y++) {
    const dy = (y + pad) * size
    for (let x = 0; x < glyph; x++) {
      const s = (y * glyph + x) * 4
      if (small[s + 3] === 0) continue
      const d = (dy + x + pad) * 4
      canvas[d] = small[s]
      canvas[d + 1] = small[s + 1]
      canvas[d + 2] = small[s + 2]
      canvas[d + 3] = small[s + 3]
    }
  }
  return canvas
}

/** 感知亮度 0–255 */
function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * macOS Template：只有 alpha 有意义。
 * 浅色像素 → 不透明（系统渲染为黑/白方块）；深色像素 → 镂空。
 * 菜单栏深色时呈「白方框 + 镂空 W」，浅色时「黑方框 + 镂空 W」，两向都清晰。
 */
function toTemplate(px) {
  const out = new Uint8ClampedArray(px.length)
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]
    if (a <= 2) continue
    const l = luma(px[i], px[i + 1], px[i + 2])
    // 用 alpha 做边缘羽化：亮度越高越不透明
    const t = (l - 90) / 90 // 90 附近为中性过渡
    out[i] = 0
    out[i + 1] = 0
    out[i + 2] = 0
    out[i + 3] = Math.max(0, Math.min(255, Math.round(a * Math.max(0, Math.min(1, t)))))
  }
  return out
}

/** Windows 托盘：按主题给固定配色，保证在任务栏上有足够对比 */
function toWin(px, mode) {
  const out = new Uint8ClampedArray(px)
  if (mode === 'light') {
    // 深色主题 → 浅色图标：保持原样（白方框 + 深色 W）
    return out
  }
  // 浅色主题 → 深色图标：反相亮度，方框变深、W 变浅
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    out[i] = 255 - out[i]
    out[i + 1] = 255 - out[i + 1]
    out[i + 2] = 255 - out[i + 2]
  }
  return out
}

// ============================================================
//  4. 执行
// ============================================================
function write(rel, buf) {
  const p = join(ROOT, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, buf)
  console.log(`  ✓ ${rel.padEnd(30)} ${(buf.length / 1024).toFixed(1)} KB`)
}

console.log('从 build/icon.png 派生托盘图标…')
const src = decodePng(readFileSync(join(ROOT, 'build/icon.png')))
console.log(`  源图标 ${src.width}×${src.height}`)

/**
 * 尺寸与留白：
 *  · 两个平台最终都是 tray.ts resize 到 16pt 渲染，这里统一出 32px
 *    画布（@2x 素材，缩小后抗锯齿更干净）。
 *  · compose 会先自动裁掉源图标自带的透明边距，再按 fill 铺进画布，
 *    所以 fill 就是图形真正的可见占比。
 *  · fill 取 0.9 → 图形 29px → 渲染到 16pt 后约 14.4pt，
 *    与 WiFi / 电池 / 音量等系统菜单栏图标视觉重量一致。
 *  · ⚠️ 不要再靠调小 fill 来「缩小图标」：真正的渲染尺寸由 tray.ts 的
 *    resize(16) 决定（早期漏了这步，44px 素材被当成 44pt 画出来，
 *    直接撑爆菜单栏）。fill 只管图形在画布内的占比。
 */
const MAC_CANVAS = 32
const MAC_FILL = 0.9
const WIN_CANVAS = 32
const WIN_FILL = 0.9

write(
  'build/trayTemplate.png',
  encodePng(toTemplate(compose(src.rgba, src.width, MAC_CANVAS, MAC_FILL)), MAC_CANVAS, MAC_CANVAS)
)
write(
  'build/trayWin-light.png',
  encodePng(toWin(compose(src.rgba, src.width, WIN_CANVAS, WIN_FILL), 'light'), WIN_CANVAS, WIN_CANVAS)
)
write(
  'build/trayWin-dark.png',
  encodePng(toWin(compose(src.rgba, src.width, WIN_CANVAS, WIN_FILL), 'dark'), WIN_CANVAS, WIN_CANVAS)
)
console.log('完成。')
