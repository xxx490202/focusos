// ============================================================
//  settings-merge.test.ts — 读档时的默认值补齐（向后兼容）
// ============================================================
//  背景：Settings 里有嵌套对象（background / durations / notifications / dnd）。
//  如果读档时用浅合并，旧文件里的 background 会整体覆盖默认值，
//  新版本追加的子字段（rotate / order）就全都不存在 →
//  zod 校验失败 → 用户数据被判损坏、回退成空数据。
//
//  这个文件用「升级前真实存在的文件形态」把这件事钉死。
// ============================================================
import { describe, it, expect } from 'vitest'
import { mergeDeep, defaultSettings } from '@shared/defaults'
import { zSettings } from '@shared/ipc-contract'

describe('mergeDeep 基本语义', () => {
  it('patch 缺失的键保留 base 的值', () => {
    expect(mergeDeep({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 })
  })

  it('嵌套对象递归合并，而不是整体覆盖', () => {
    const base = { outer: { x: 1, y: 2 } }
    expect(mergeDeep(base, { outer: { y: 9 } })).toEqual({ outer: { x: 1, y: 9 } })
  })

  it('undefined 不覆盖已有值', () => {
    expect(mergeDeep({ a: 1 }, { a: undefined })).toEqual({ a: 1 })
  })

  it('数组整体替换（顺序本身是语义，不能逐项合并）', () => {
    const base = { list: ['a', 'b', 'c'] }
    expect(mergeDeep(base, { list: ['c'] })).toEqual({ list: ['c'] })
  })

  it('patch 不是对象时原样返回 base', () => {
    expect(mergeDeep({ a: 1 }, null)).toEqual({ a: 1 })
    expect(mergeDeep({ a: 1 }, 'x')).toEqual({ a: 1 })
    expect(mergeDeep({ a: 1 }, [1, 2])).toEqual({ a: 1 })
  })

  it('不修改传入的 base（纯函数）', () => {
    const base = { outer: { x: 1 } }
    mergeDeep(base, { outer: { x: 2 } })
    expect(base.outer.x).toBe(1)
  })
})

describe('⭐ 向后兼容：旧版文件缺少新增字段时仍能读档', () => {
  /**
   * 这是 v1.0.0 发布时磁盘上真实存在的 background 形态 ——
   * 没有 rotate、没有 order、也没有 rain。
   * 新增这些字段后，读档必须仍然成功。
   */
  const OLD_BACKGROUND = {
    enabled: true,
    rotateSeconds: 30,
    overlay: 30,
    blur: 0,
    vignette: 0,
    autoTextColor: true
  }

  it('深合并后旧 background 会被补上 rotate / order / rain', () => {
    const merged = mergeDeep(defaultSettings(), { background: OLD_BACKGROUND })
    expect(merged.background.rotate).toBe(true)
    expect(merged.background.order).toEqual([])
    // 雨点是后加的：老文件没有这个键，补齐后应取默认「开」
    expect(merged.background.rain).toBe(true)
    // 用户原来的设置不能被改掉
    expect(merged.background.enabled).toBe(true)
    expect(merged.background.rotateSeconds).toBe(30)
  })

  it('深合并后再过 zod 校验一定通过', () => {
    const merged = mergeDeep(defaultSettings(), {
      background: OLD_BACKGROUND,
      // 同时模拟旧文件没有 sidebarCollapsed
      sidebarCollapsed: undefined
    })
    const r = zSettings.safeParse(merged)
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
  })

  it('⭐ 反例：浅合并会直接校验失败（这就是当初的隐患）', () => {
    const shallow = { ...defaultSettings(), background: OLD_BACKGROUND }
    const r = zSettings.safeParse(shallow)
    expect(r.success).toBe(false)
  })

  /**
   * background.hidden（已移除但未删掉的背景图）是后加的字段。
   * 深合并会给它补上默认值，但读档路径之外还有别的入口
   * （例如渲染层直接 patch 一个不含 hidden 的 background），
   * 所以 zod 侧必须自带 .default([]) —— 否则老文件会被判损坏。
   */
  it('⭐ 不依赖深合并：background 缺 hidden 也能过 zod，并补成空数组', () => {
    const r = zSettings.safeParse({
      ...defaultSettings(),
      background: OLD_BACKGROUND // 没有 hidden、也没有 rotate / order
    })
    // 缺 rotate / order 仍然失败（它们是必填，靠深合并兜）
    expect(r.success).toBe(false)

    const withNewFields = zSettings.safeParse({
      ...defaultSettings(),
      background: { ...OLD_BACKGROUND, rotate: true, order: [] } // 只缺 hidden / rain
    })
    expect(withNewFields.success, JSON.stringify(withNewFields.error?.issues)).toBe(true)
    expect(withNewFields.data?.background.hidden).toEqual([])
    // 同一个理由：rain 也必须自带 .default，否则老文件一样会判损坏
    expect(withNewFields.data?.background.rain).toBe(true)
  })

  it('⭐ rain 缺省时必须补成 true（不能是 undefined）', () => {
    const r = zSettings.safeParse({
      ...defaultSettings(),
      background: {
        ...defaultSettings().background,
        rain: undefined as unknown as boolean
      }
    })
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    expect(r.data?.background.rain).toBe(true)
  })

  it('旧文件的其它设置项原样保留', () => {
    const merged = mergeDeep(defaultSettings(), {
      theme: 'light',
      durations: { workMinutes: 50 },
      background: OLD_BACKGROUND
    })
    expect(merged.theme).toBe('light')
    expect(merged.durations.workMinutes).toBe(50)
    // durations 里未提供的子字段仍取默认值
    expect(merged.durations.shortBreakMinutes).toBe(
      defaultSettings().durations.shortBreakMinutes
    )
    expect(zSettings.safeParse(merged).success).toBe(true)
  })

  it('settings 缺字段、为空、为 undefined 都能收住', () => {
    for (const patch of [undefined, null, {}, { background: {} }]) {
      const merged = mergeDeep(defaultSettings(), patch)
      expect(zSettings.safeParse(merged).success).toBe(true)
    }
  })
})
