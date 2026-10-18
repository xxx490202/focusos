// ============================================================
//  TimeWheelPicker.tsx — 分 / 秒 选择弹窗
// ============================================================
//  ⭐ 用户规则（专注页）：
//    · 点倒计时左边的「分」→ 数字下方弹出选择器，0–60
//    · 点右边的「秒」→ 同一个选择器
//    · 弹窗**最多只显示 10 行**，超出靠滚动（"上下滑动选择"）
//    · **00 在最上面**（普通列表，不是把选中项摆中间）
//
//  ⚠️ 两个踩过的坑：
//    1. 必须自己给 z-index。专注页的 .center 带 z-index: var(--z-content)，
//       而本弹窗是它的兄弟节点 —— 不给 z-index 就会被整层盖住，
//       表现为「数字看得见但点不动、滚不动」（命中测试全落到 .center 上）。
//    2. 定位用 position: fixed + 视口夹取：专注页根节点是 overflow:hidden，
//       绝对定位的弹窗会被裁掉；倒计时又在视口偏下，需要能自动翻到上方。
// ============================================================
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './TimeWheelPicker.module.css'

/** 单行高度 */
const ITEM_H = 32
/** 最多同时可见的行数（用户指定 10） */
const VISIBLE = 10
const PANEL_H = ITEM_H * VISIBLE
const PANEL_W = 92

export interface PickerAnchor {
  left: number
  right: number
  top: number
  bottom: number
}

interface Props {
  /** 触发元素在屏幕上的矩形 */
  anchor: PickerAnchor
  /** 打开时停留的值（也是高亮项） */
  value: number
  /** 可选最大值（含） */
  max: number
  /** 点击某一项 */
  onPick: (n: number) => void
  onClose: () => void
}

export function TimeWheelPicker({ anchor, value, max, onPick, onClose }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(value)

  const items = Array.from({ length: max + 1 }, (_, i) => i)

  /*
   * 开屏滚动：把当前值顶到**第一行**。
   * ⭐ 这正是「00 要在最上面」的实现 —— 值为 0 时 scrollTop=0，
   *    列表就从 00 开始往下排，不会出现「00 悬在中间、上面一片空」。
   *    值较大时同样让选中项落在顶部（到底部时自然夹取到最大滚动位置）。
   */
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
    el.scrollTop = Math.min(value * ITEM_H, maxScroll)
  }, [value])

  // Esc / 点空白关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) onClose()
    }
    /*
     * ⚠️ keydown 必须用**捕获**阶段：专注页有全局空格/方向键快捷键，
     *    不抢在它们之前拦下 Esc，弹窗就关不掉。
     */
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // ---- 定位：优先在下方，空间不够则翻到上方 ----
  const centerX = (anchor.left + anchor.right) / 2
  const left = Math.max(8, Math.min(centerX - PANEL_W / 2, window.innerWidth - PANEL_W - 8))
  const spaceBelow = window.innerHeight - anchor.bottom
  const openUp = spaceBelow < PANEL_H + 20
  const top = openUp
    ? Math.max(8, anchor.top - PANEL_H - 10)
    : Math.min(anchor.bottom + 10, window.innerHeight - PANEL_H - 8)

  return (
    <div
      className={styles.panel}
      style={{ left, top, width: PANEL_W, height: PANEL_H }}
      role="listbox"
      aria-label="选择数值"
      data-testid="time-wheel-picker"
    >
      <div ref={listRef} className={styles.list}>
        {items.map((n) => (
          <button
            key={n}
            type="button"
            className={styles.item}
            data-active={n === active ? 'true' : 'false'}
            style={{ height: ITEM_H }}
            onClick={() => {
              setActive(n)
              onPick(n)
              onClose()
            }}
            role="option"
            aria-selected={n === active}
          >
            {String(n).padStart(2, '0')}
          </button>
        ))}
      </div>
    </div>
  )
}
