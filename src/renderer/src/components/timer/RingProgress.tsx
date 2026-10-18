// ============================================================
//  RingProgress.tsx — 环形进度（手写 SVG）
// ============================================================
//  ⭐ 图表全部手写 SVG，禁止引入图表库。
//     阶段切换时颜色用 CSS transition 平滑过渡。
// ============================================================
import type { CSSProperties } from 'react'
import styles from './RingProgress.module.css'

interface Props {
  /** 0–1 */
  progress: number
  size?: number
  stroke?: number
  /** 专注=绿，休息=橙 —— 由主题令牌驱动，不写死色值 */
  phase: 'focus' | 'break'
  children?: React.ReactNode
  /** 阶段切换时的一次性高亮 */
  glow?: boolean
}

export function RingProgress({
  progress,
  size = 220,
  stroke = 10,
  phase,
  children,
  glow = false
}: Props) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  // ⭐ 阶段色用语义令牌，随主题自动适配
  const color = phase === 'focus' ? 'var(--focus)' : 'var(--break)'
  const track = 'var(--divider-strong)'

  const clamped = Math.max(0, Math.min(1, progress))
  const style: CSSProperties & { ['--ring-color']: string } = { ['--ring-color']: color }

  return (
    <div
      className={glow ? `${styles.wrap} ${styles.glow}` : styles.wrap}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} style={style} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={track}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          // 从 12 点方向开始，顺时针推进
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={styles.arc}
        />
      </svg>
      {children !== undefined && <div className={styles.center}>{children}</div>}
    </div>
  )
}
