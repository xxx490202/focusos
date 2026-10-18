// ============================================================
//  backgrounds.ts — 背景图排序（纯函数）
// ============================================================
//  ⚠️ 目录扫描（listBackgrounds）只能给出「发现顺序」，无法表达用户的偏好。
//     用户在设置页拖拽排序后写入 settings.background.order。
//     这里负责把两者合并成最终展示顺序。
//
//  规则（三条，缺一不可）：
//   1. order 里出现且确实存在的图片，按 order 的顺序排在前面
//   2. order 里已不存在的路径（图片被删了）直接丢弃，不留空位
//   3. 扫描到但不在 order 里的图片（刚导入的新图）按原扫描顺序追加在最后
//      —— 否则新导入的图会「消失」，用户会以为导入失败
// ============================================================

/**
 * 把「扫描顺序」与「用户排序」合并为最终展示顺序。
 *
 * @param all   扫描得到的全部背景图（file:// URL），顺序 = 发现顺序
 * @param order 用户在设置页排定的顺序（可能过时、可能残缺）
 */
export function orderBackgrounds(all: string[], order: readonly string[]): string[] {
  if (all.length === 0) return []
  if (order.length === 0) return [...all]

  const remaining = new Set(all)
  const result: string[] = []

  // 1 + 2：按用户顺序取，跳过已被删除的
  for (const url of order) {
    if (remaining.has(url)) {
      result.push(url)
      remaining.delete(url)
    }
  }

  // 3：把新导入的（不在 order 里的）按扫描顺序补在末尾
  for (const url of all) {
    if (remaining.has(url)) result.push(url)
  }

  return result
}

/**
 * 背景模式实际应该显示哪一张。
 *
 * @param list   已排序的背景列表
 * @param rotate 是否开启轮播
 * @param index  轮播游标（rotate 为 false 时忽略）
 *
 * ⚠️ 不轮播时固定取**第一张** —— 这是用户明确要求的语义：
 *    「第一张为不开启轮播的背景」。
 */
export function activeBackground(
  list: readonly string[],
  rotate: boolean,
  index = 0
): string | null {
  if (list.length === 0) return null
  if (!rotate) return list[0]
  return list[index % list.length]
}

/** 轮播步进：不轮播或只有一张时恒为 0，避免无意义的重渲染 */
export function nextBackgroundIndex(
  current: number,
  listLength: number,
  rotate: boolean
): number {
  if (!rotate || listLength <= 1) return 0
  return (current + 1) % listLength
}

/** 把某张图移动到列表中的新位置（拖拽排序用），返回新数组 */
export function moveBackground(
  list: readonly string[],
  from: number,
  to: number
): string[] {
  const next = [...list]
  if (from < 0 || from >= next.length) return next
  const clamped = Math.max(0, Math.min(next.length - 1, to))
  const [item] = next.splice(from, 1)
  next.splice(clamped, 0, item)
  return next
}

/**
 * 雨点大小设置的映射：0..100 → 0.5×..1.5×（50 恰为 1.00×，默认观感不变）。
 *
 * ⚠️ 渲染层（BackgroundFX 缩放每滴雨的粗细/长度）与设置页（显示几倍）
 *    必须走这一个函数，避免两处各写一遍公式后对不上。
 */
export function rainSizeScale(rainSize: number): number {
  const v = Math.max(0, Math.min(100, rainSize))
  return 0.5 + v / 100
}

