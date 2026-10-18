// ============================================================
//  i18n.test.ts — 双语的完整性与正确性
// ============================================================
//  ⭐ 关键用例是第一条：**源码里每一个 t('…') 都必须在词典里查到**。
//     词条键就是中文原文，所以「忘了翻译」不会报错、只会静默显示中文 ——
//     这条用例把「静默漏译」变成「测试失败」。
// ============================================================
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { translate, isLang, LANGS, weekdayLabel, monthLabel, yearMonthLabel } from '../src/shared/i18n'
import { EN } from '../src/shared/i18n.en'

const ROOT = resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|ts)$/.test(name)) out.push(p)
  }
  return out
}

/** 去掉注释，避免把注释里的中文当成待翻词条 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

/** 收集源码里所有 t('…') / translate('…') 的实参 */
function collectKeys(): string[] {
  const files = [
    ...walk(join(ROOT, 'src/renderer/src')),
    ...walk(join(ROOT, 'src/shared')),
    ...walk(join(ROOT, 'src/main'))
  ]
  const found = new Set<string>()
  // t('…') / t("…") / translate('…')；排除 t(variable) 这种动态调用
  const re = /(?<![A-Za-z0-9_$.])(?:t|translate)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*[),]/g
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'))
    for (const m of src.matchAll(re)) {
      const raw = (m[1] ?? m[2] ?? '').replace(/\s+/g, ' ').trim()
      if (/[\u4e00-\u9fa5]/.test(raw)) found.add(raw)
    }
  }
  return [...found].sort()
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g
function placeholders(s: string): string[] {
  return [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort()
}

describe('词典完整性', () => {
  it('源码里每个 t(\'中文\') 都能在英文词典里查到', () => {
    const missing = collectKeys().filter((k) => !(k in EN))
    expect(missing, `以下词条缺英文翻译：\n${missing.join('\n')}`).toEqual([])
  })

  it('词典不含空值', () => {
    const empty = Object.entries(EN)
      .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
      .map(([k]) => k)
    expect(empty).toEqual([])
  })

  it('译文里的占位符与原文一一对应（漏一个就会显示成 {xxx}）', () => {
    const bad: string[] = []
    for (const [zh, en] of Object.entries(EN)) {
      const a = placeholders(zh).join(',')
      const b = placeholders(en).join(',')
      if (a !== b) bad.push(`${zh}  [${a}] → ${en}  [${b}]`)
    }
    expect(bad, `占位符不匹配：\n${bad.join('\n')}`).toEqual([])
  })
})

describe('translate', () => {
  it('中文直接返回原文', () => {
    expect(translate('新建任务', 'zh')).toBe('新建任务')
  })

  it('英文查词典', () => {
    expect(translate('新建任务', 'en')).toBe(EN['新建任务'])
  })

  it('词典缺失时回落中文原文，绝不返回空串', () => {
    const out = translate('这是一个不存在的词条', 'en')
    expect(out).toBe('这是一个不存在的词条')
    expect(out).not.toBe('')
  })

  it('插值替换全部同名占位符', () => {
    expect(translate('{a} 与 {a}', 'zh', { a: 'X' })).toBe('X 与 X')
  })

  it('缺变量时保留占位符（便于一眼看出漏传）', () => {
    expect(translate('{a}-{b}', 'zh', { a: '1' })).toBe('1-{b}')
  })
})

describe('语言清单', () => {
  it('中英两种，且都用各自语言的原生写法（便于切回去）', () => {
    expect(LANGS.map((l) => l.id)).toEqual(['zh', 'en'])
    for (const l of LANGS) {
      expect(l.native.length).toBeGreaterThan(0)
      expect(l.hint.length).toBeGreaterThan(0)
    }
    expect(LANGS[0].native).toContain('中文')
    expect(LANGS[1].native).toBe('English')
  })

  it('isLang 只认 zh / en', () => {
    expect(isLang('zh')).toBe(true)
    expect(isLang('en')).toBe(true)
    expect(isLang('jp')).toBe(false)
    expect(isLang(undefined)).toBe(false)
    expect(isLang(null)).toBe(false)
  })
})

describe('日历语言数据', () => {
  it('星期按语言给出，索引越界自动回绕', () => {
    expect(weekdayLabel(1, 'zh', true)).toBe('周一')
    expect(weekdayLabel(1, 'en')).toBe('Mon')
    expect(weekdayLabel(7, 'en')).toBe('Sun')
    expect(weekdayLabel(-1, 'zh', true)).toBe('周六')
  })

  it('月份按语言给出', () => {
    expect(monthLabel(9, 'en')).toBe('Oct')
    expect(monthLabel(0, 'zh', true)).toBe('一月')
  })

  it('年+月标题的语序随语言变化（中文年在前，英文月在前）', () => {
    expect(yearMonthLabel(2026, 9, 'zh')).toBe('2026 年 10 月')
    expect(yearMonthLabel(2026, 9, 'en')).toBe('October 2026')
  })
})
