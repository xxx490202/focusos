// ============================================================
//  backgrounds.test.ts — 背景图排序与轮播选择
// ============================================================
//  这几条规则直接决定用户「导入的图会不会消失」「关掉轮播后显示哪张」，
//  是容易在重构中被悄悄改坏的地方，因此单独锁住。
// ============================================================
import { describe, it, expect } from 'vitest'
import {
  orderBackgrounds,
  activeBackground,
  nextBackgroundIndex,
  moveBackground
} from '@shared/backgrounds'

const A = 'file:///a.png'
const B = 'file:///b.png'
const C = 'file:///c.png'
const D = 'file:///d.png'

describe('背景图排序 orderBackgrounds', () => {
  it('order 为空时保持扫描顺序', () => {
    expect(orderBackgrounds([A, B, C], [])).toEqual([A, B, C])
  })

  it('按 order 重排', () => {
    expect(orderBackgrounds([A, B, C], [C, A, B])).toEqual([C, A, B])
  })

  it('⭐ 新导入的图（不在 order 里）追加到末尾，不能丢', () => {
    // 用户排过 [C, A]，之后又导入了 B —— B 必须仍然出现
    expect(orderBackgrounds([A, B, C], [C, A])).toEqual([C, A, B])
  })

  it('order 里已被删除的路径直接丢弃，不留空位', () => {
    expect(orderBackgrounds([A, C], [C, B, A])).toEqual([C, A])
  })

  it('扫描为空时返回空', () => {
    expect(orderBackgrounds([], [A, B])).toEqual([])
  })

  it('结果与输入长度一致（既不丢也不重复）', () => {
    const all = [A, B, C, D]
    const out = orderBackgrounds(all, [C, A, C])
    expect(out).toHaveLength(4)
    expect(new Set(out).size).toBe(4)
  })
})

describe('当前生效的背景 activeBackground', () => {
  it('不轮播时固定第一张（用户要求的语义）', () => {
    expect(activeBackground([C, A, B], false, 0)).toBe(C)
    // 游标被忽略：即使传了别的下标也仍然取第一张
    expect(activeBackground([C, A, B], false, 2)).toBe(C)
  })

  it('轮播时按游标取，并自动取模', () => {
    expect(activeBackground([A, B, C], true, 0)).toBe(A)
    expect(activeBackground([A, B, C], true, 2)).toBe(C)
    expect(activeBackground([A, B, C], true, 4)).toBe(B)
  })

  it('空列表返回 null', () => {
    expect(activeBackground([], true, 0)).toBeNull()
    expect(activeBackground([], false, 0)).toBeNull()
  })
})

describe('轮播步进 nextBackgroundIndex', () => {
  it('关闭轮播时恒为 0，不产生无意义的重渲染', () => {
    expect(nextBackgroundIndex(3, 5, false)).toBe(0)
  })

  it('只有一张时恒为 0', () => {
    expect(nextBackgroundIndex(0, 1, true)).toBe(0)
  })

  it('正常轮播时循环推进', () => {
    expect(nextBackgroundIndex(0, 3, true)).toBe(1)
    expect(nextBackgroundIndex(2, 3, true)).toBe(0)
  })
})

describe('拖拽排序 moveBackground', () => {
  it('向后移动', () => {
    expect(moveBackground([A, B, C], 0, 2)).toEqual([B, C, A])
  })

  it('向前移动', () => {
    expect(moveBackground([A, B, C], 2, 0)).toEqual([C, A, B])
  })

  it('原地不动时保持原样', () => {
    expect(moveBackground([A, B, C], 1, 1)).toEqual([A, B, C])
  })

  it('越界的目标位置被夹取到两端', () => {
    expect(moveBackground([A, B, C], 0, 99)).toEqual([B, C, A])
    expect(moveBackground([A, B, C], 2, -5)).toEqual([C, A, B])
  })

  it('非法来源下标时原样返回，且不改动入参', () => {
    const src = [A, B, C]
    expect(moveBackground(src, 9, 0)).toEqual(src)
    expect(src).toEqual([A, B, C])
  })
})
