// ============================================================
//  contrast.test.ts — 语义色对比度与主题令牌一致性
// ============================================================
//  锁住规范里的硬性要求：
//    「浅色主题下 --warning 等语义色对比度 ≥ 4.5:1」
//  以及一条工程一致性：
//    「设置页主题预览小样条里写死的色值必须与 themes.css 同步」
//
//  ⚠️ 这些值一旦被改动导致不达标，测试立刻变红 —— 而不是等用户看不清字才发现。
// ============================================================
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const STYLES = join(__dirname, '../src/renderer/src/styles')
const SETTINGS_CSS = join(__dirname, '../src/renderer/src/views/SettingsView.module.css')

const themesCss = readFileSync(join(STYLES, 'themes.css'), 'utf8')
const settingsCss = readFileSync(SETTINGS_CSS, 'utf8')

// ---------------- 颜色工具 ----------------

type RGB = [number, number, number]

function parseColor(raw: string): RGB | null {
  const s = raw.trim()
  const six = s.match(/^#([0-9a-f]{6})$/i)
  if (six) {
    const n = parseInt(six[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const three = s.match(/^#([0-9a-f]{3})$/i)
  if (three) {
    const c = three[1]
    return [
      parseInt(c[0] + c[0], 16),
      parseInt(c[1] + c[1], 16),
      parseInt(c[2] + c[2], 16)
    ]
  }
  const fn = s.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const p = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return [p[0], p[1], p[2]]
  }
  return null
}

function relativeLuminance([r, g, b]: RGB): number {
  const ch = (v: number): number => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

/** WCAG 2.1 对比度，1:1 – 21:1 */
function contrast(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// ---------------- CSS 解析 ----------------

/** 取出某个选择器规则块内的全部声明 */
function blockOf(css: string, selector: string): string {
  const i = css.indexOf(selector)
  if (i < 0) throw new Error(`找不到选择器：${selector}`)
  const start = css.indexOf('{', i)
  let depth = 0
  let end = start
  for (let k = start; k < css.length; k++) {
    if (css[k] === '{') depth++
    else if (css[k] === '}') {
      depth--
      if (depth === 0) {
        end = k
        break
      }
    }
  }
  return css.slice(start + 1, end)
}

/** 取出规则块内全部 --变量: 值; （忽略带注释的行尾注释） */
function varsOf(css: string, selector: string): Record<string, string> {
  const body = blockOf(css, selector)
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
    // 去掉行尾注释（如 `#707680; /* 4.57:1 */` 已被 ; 截断，这里再兜一层）
    out[m[1]] = m[2].replace(/\/\*[\s\S]*?\*\//g, '').trim()
  }
  return out
}

const light = varsOf(themesCss, "[data-theme='light']")
const dark = varsOf(themesCss, "[data-theme='dark']")

// ============================================================
//  1. 语义色对比度
// ============================================================

/**
 * 这些令牌在真实代码里被当作**文字色**使用（已核对使用处），
 * 因此必须满足 WCAG AA 正文标准 4.5:1。
 * 其余令牌（--surface / --divider / --shadow…）是背景与非文字元素，不在此列。
 */
const TEXT_TOKENS = [
  '--text-1',
  '--text-2',
  '--text-3',
  '--accent',
  '--focus',
  '--break',
  '--danger',
  '--warning',
  '--success'
]

/** 文字可能压在其上的所有表面色 */
const SURFACES = ['--bg', '--surface', '--surface-2']

function assertOnAllSurfaces(
  themeName: 'light' | 'dark',
  vars: Record<string, string>
): { worst: number; lines: string[] } {
  const lines: string[] = []
  let worst = Infinity

  for (const token of TEXT_TOKENS) {
    const fg = parseColor(vars[token])
    expect(fg, `${themeName} ${token} 无法解析：${vars[token]}`).not.toBeNull()

    for (const surface of SURFACES) {
      const bg = parseColor(vars[surface])
      expect(bg, `${themeName} ${surface} 无法解析`).not.toBeNull()
      const r = contrast(fg as RGB, bg as RGB)
      worst = Math.min(worst, r)
      lines.push(`${themeName} ${token} on ${surface} = ${r.toFixed(2)}:1`)
    }
  }
  return { worst, lines }
}

describe('语义色对比度 —— WCAG AA（正文 4.5:1）', () => {
  it('浅色主题：全部语义色对每种表面 ≥ 4.5:1', () => {
    const { worst, lines } = assertOnAllSurfaces('light', light)
    if (worst < 4.5) console.error(lines)
    expect(worst, `最差对比度 ${worst.toFixed(2)}:1，低于 4.5:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('深色主题：全部语义色对每种表面 ≥ 4.5:1', () => {
    const { worst, lines } = assertOnAllSurfaces('dark', dark)
    if (worst < 4.5) console.error(lines)
    expect(worst, `最差对比度 ${worst.toFixed(2)}:1，低于 4.5:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('--on-solid 压在每一种实心语义色上 ≥ 4.5:1', () => {
    // ⚠️ 深色主题的语义色是为暗底设计的**亮色**，白字压上去实测只有 1.41–3.65:1
    //    （--warning 1.41、--focus 2.02），因此深色的 --on-solid 必须是近黑。
    //    两个主题各自取「与该主题实心色相配」的前景色，这是本用例要守住的约束。
    const SOLID_FILLS = ['--accent', '--focus', '--break', '--danger', '--warning', '--success']
    for (const [name, vars] of [
      ['light', light],
      ['dark', dark]
    ] as const) {
      const on = parseColor(vars['--on-solid'])
      expect(on, `${name} 缺少 --on-solid`).not.toBeNull()
      for (const t of SOLID_FILLS) {
        const r = contrast(on as RGB, parseColor(vars[t]) as RGB)
        expect(r, `${name} --on-solid on ${t} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('浅色主题的 --warning / --danger / --focus 明确达标（规范点名项）', () => {
    for (const t of ['--warning', '--danger', '--focus', '--accent', '--success', '--break']) {
      const r = contrast(parseColor(light[t]) as RGB, parseColor(light['--surface']) as RGB)
      expect(r, `light ${t} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

// ============================================================
//  2. 设置页不写死色值
// ============================================================
//  ⚠️ 这里曾经有一组用例：「设置页主题预览小样条 与 themes.css 同步」。
//     那个小样条（预览 / 卡片 / 标签）是全项目唯一允许写死色值的地方，
//     因为它要在同一屏同时展示两套主题，CSS 变量沿 [data-theme] 级联拿不到
//     「另一套」的值。
//     该小样条已按用户要求整块删除，那组同步用例也随之下线，
//     换成下面这条更普适的守卫：设置页只消费语义令牌，不再出现硬编码色值。
//     若今后再引入「同屏展示两套主题」的色块，请把同步用例一并加回来。

describe('设置页样式只消费语义令牌', () => {
  it('不再出现硬编码的十六进制色值', () => {
    const hex = [...settingsCss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
    expect(hex, `设置页出现了硬编码色值，请改用语义令牌：\n${hex.join('\n')}`).toEqual([])
  })
})

// ============================================================
//  3. 令牌完整性
// ============================================================

describe('主题令牌完整性', () => {
  it('两套主题定义了同一组语义色令牌', () => {
    const keys = (o: Record<string, string>): string[] =>
      Object.keys(o).filter((k) => k.startsWith('--')).sort()
    expect(keys(light)).toEqual(keys(dark))
  })

  it('必需的语义令牌都齐备', () => {
    for (const k of [
      ...TEXT_TOKENS,
      '--on-solid',
      '--bg',
      '--surface',
      '--surface-2',
      '--surface-hover',
      '--divider',
      '--divider-strong',
      '--accent-soft',
      '--focus-soft',
      '--break-soft'
    ]) {
      expect(light[k], `light 缺少 ${k}`).toBeDefined()
      expect(dark[k], `dark 缺少 ${k}`).toBeDefined()
    }
  })
})
