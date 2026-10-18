/**
 * ============================================================
 *  extract-icon.mjs — 从 .icns 容器中提取最大尺寸 PNG
 * ============================================================
 *  .icns 本质是「块集合」容器：
 *    [4B 'icns'][4B 总长度(大端)] 然后反复：
 *    [4B 类型][4B 长度(大端，含头8B)][负载]
 *  现代 .icns 的负载直接就是 PNG 数据，因此无需任何图像解码库，
 *  只需扫描块头、按 IHDR 宽高挑出最大那张，原样写出即可。
 *
 *  ⚠️ 纯 Node 实现，不调用 sips / ImageMagick 等外部命令，
 *     也不引入任何原生模块。
 *
 *  用法：node scripts/extract-icon.mjs <in.icns> [out.png]
 *  out.png 缺省为 build/icon.png
 * ============================================================
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const [, , inPath, outArg] = process.argv
if (!inPath) {
  console.error('用法: node scripts/extract-icon.mjs <in.icns> [out.png]')
  process.exit(1)
}
const outPath = outArg ? resolve(outArg) : join(ROOT, 'build/icon.png')

const buf = readFileSync(inPath)

// ---- 校验 magic ----
const magic = buf.toString('latin1', 0, 4)
if (magic !== 'icns') {
  console.error(`✗ 不是合法的 .icns 文件（magic=${JSON.stringify(magic)}）`)
  process.exit(1)
}
const totalLength = buf.readUInt32BE(4)

/** 读取 PNG 负载的宽高（IHDR 固定在负载开头） */
function pngSize(data) {
  if (
    data.length < 24 ||
    data.readUInt32BE(0) !== 0x89504e47 ||
    data.readUInt32BE(4) !== 0x0d0a1a0a ||
    data.toString('latin1', 12, 16) !== 'IHDR'
  ) {
    return null
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

/** icns 各类型对应的标称像素尺寸（含 @2x 的会更大，以实际 IHDR 为准） */
const TYPE_HINT = {
  icp4: 16, icp5: 32, icp6: 64,
  ic07: 128, ic08: 256, ic09: 512, ic10: 1024,
  ic11: 32, ic12: 64, ic13: 256, ic14: 512,
  ic04: 16, ic05: 32, ic06: 64
}

let offset = 8
const limit = Math.min(buf.length, totalLength || buf.length)
const found = []

while (offset + 8 <= limit) {
  const type = buf.toString('latin1', offset, offset + 4)
  const size = buf.readUInt32BE(offset + 4)
  if (size < 8 || offset + size > buf.length) break

  const payload = buf.subarray(offset + 8, offset + size)
  const size4 = pngSize(payload)
  if (size4) {
    found.push({ type, hint: TYPE_HINT[type] ?? 0, ...size4, payload })
  }
  offset += size
}

if (found.length === 0) {
  console.error('✗ 未在 .icns 中找到任何 PNG 负载')
  process.exit(1)
}

found.sort((a, b) => b.width * b.height - a.width * a.height || b.width - a.width)
const best = found[0]

console.log('发现以下尺寸：')
for (const f of found) {
  console.log(`  ${f.type.padEnd(6)} ${String(f.width).padStart(5)}×${String(f.height).padEnd(5)}`)
}
console.log(`\n选用最大尺寸：${best.type} ${best.width}×${best.height}`)

if (best.width !== 1024 || best.height !== 1024) {
  console.warn(`⚠️  最大尺寸为 ${best.width}×${best.height}，非 1024×1024。`)
  console.warn('   将按原样写出；electron-builder 会自行缩放生成 .icns / .ico。')
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, best.payload)
console.log(`✓ 已写出 ${outPath}（${(best.payload.length / 1024).toFixed(1)} KB）`)
