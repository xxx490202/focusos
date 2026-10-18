// ============================================================
//  Charts.tsx — 全部图表手写 SVG
// ============================================================
//  ⭐ 禁止引入图表库。所有图形用 SVG + CSS 变量实现，
//     颜色一律走语义令牌，因此自动适配双主题。
// ============================================================
import { useState } from 'react'
import { CATEGORY_LABEL } from '@shared/defaults'
import { weekdayLabel } from '@shared/i18n'
import { formatDuration, ratio } from '@shared/schedule'
import type { StatRangePayload } from '@shared/ipc-contract'
import type { Category } from '@shared/types'
import { useT, useI18n } from '../../i18n'
import styles from './Charts.module.css'

// ============================================================
//  1. 近一年贡献热力图（GitHub 风格）○
// ============================================================
export function YearHeatmap({ data }: { data: { date: string; count: number }[] }) {
  const t = useT()
  const [hover, setHover] = useState<{ date: string; count: number } | null>(null)

  // 补齐到完整 53 周
  const map = new Map(data.map((d) => [d.date, d.count]))
  const max = Math.max(1, ...data.map((d) => d.count))

  // 从今天倒推 364 天
  const cells: { date: string; count: number }[] = []
  const today = new Date()
  for (let i = 363; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    cells.push({ date: key, count: map.get(key) ?? 0 })
  }

  const cols = 53
  const cell = 9
  const gap = 2
  const perWeek = 7

  return (
    <div className={styles.chartWrap}>
      {hover && (
        <div className={styles.tooltip}>
          {t('{date} · {n} 个番茄', { date: hover.date, n: hover.count })}
        </div>
      )}
      <svg width={cols * (cell + gap)} height={perWeek * (cell + gap)} role="img" aria-label={t('近一年专注热力图')}>
        {cells.map((c, i) => {
          const col = Math.floor(i / perWeek)
          const row = i % perWeek
          // 0 → 透明，1 → 绿
          const level = c.count === 0 ? 0 : ratio(c.count, max)
          return (
            <rect
              key={c.date}
              x={col * (cell + gap)}
              y={row * (cell + gap)}
              width={cell}
              height={cell}
              rx={2}
              fill={c.count === 0 ? 'var(--surface-2)' : 'var(--focus)'}
              opacity={c.count === 0 ? 1 : 0.28 + level * 0.72}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
            />
          )
        })}
      </svg>
      <div className={styles.legend}>
        <span>{t('少')}</span>
        {[0, 0.25, 0.5, 0.75, 1].map((lv) => (
          <span
            key={lv}
            className={styles.legendCell}
            style={{
              background: lv === 0 ? 'var(--surface-2)' : 'var(--focus)',
              opacity: lv === 0 ? 1 : 0.28 + lv * 0.72
            }}
          />
        ))}
        <span>{t('多')}</span>
      </div>
    </div>
  )
}

// ============================================================
//  2. 近 14 日柱状图（完成数 + 计划目标对照线）
// ============================================================
export function BarChart({
  data
}: {
  data: { date: string; count: number; target: number }[]
}) {
  const t = useT()
  const w = 560
  const h = 180
  const padL = 32
  const padB = 24
  const padT = 12
  const innerW = w - padL - 8
  const innerH = h - padB - padT

  const max = Math.max(
    1,
    ...data.map((d) => d.count),
    ...data.map((d) => d.target)
  )
  const bw = innerW / Math.max(1, data.length)
  const targetY = padT + (innerH * (max - (data[0]?.target ?? 12))) / max

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t('近 14 日完成数')}>
      {/* 网格 */}
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={padL}
          x2={w - 8}
          y1={padT + innerH * t}
          y2={padT + innerH * t}
          stroke="var(--divider)"
          strokeWidth={0.5}
        />
      ))}

      {/* 目标线 */}
      <line
        x1={padL}
        x2={w - 8}
        y1={targetY}
        y2={targetY}
        stroke="var(--break)"
        strokeWidth={1.2}
        strokeDasharray="4 3"
      />

      {/* 柱 */}
      {data.map((d, i) => {
        const bh = (d.count / max) * innerH
        const x = padL + i * bw + bw * 0.18
        const barW = bw * 0.64
        return (
          <g key={d.date}>
            <rect
              x={x}
              y={padT + innerH - bh}
              width={barW}
              height={Math.max(1, bh)}
              rx={3}
              fill={d.count >= d.target ? 'var(--focus)' : 'var(--accent)'}
              opacity={d.count >= d.target ? 1 : 0.65}
            >
              <title>{t('{date}：{count}/{target}', { date: d.date, count: d.count, target: d.target })}</title>
            </rect>
            {i % 2 === 0 && (
              <text
                x={x + barW / 2}
                y={h - 8}
                textAnchor="middle"
                className={styles.axisText}
              >
                {d.date.slice(5)}
              </text>
            )}
          </g>
        )
      })}

      {/* Y 轴刻度 */}
      <text x={4} y={padT + 4} className={styles.axisText}>
        {max}
      </text>
      <text x={4} y={padT + innerH} className={styles.axisText}>
        0
      </text>
    </svg>
  )
}

// ============================================================
//  3. 分类占比横条
// ============================================================
export function CategoryBars({
  data
}: {
  data: { category: string; seconds: number; count: number }[]
}) {
  const t = useT()
  const total = data.reduce((a, d) => a + d.seconds, 0)
  const ORDER: Category[] = ['work', 'study', 'health', 'life', 'other']

  const sorted = [...data].sort(
    (a, b) => ORDER.indexOf(a.category as Category) - ORDER.indexOf(b.category as Category)
  )

  if (total === 0) return <p className={styles.noData}>{t('暂无数据')}</p>

  return (
    <div className={styles.bars}>
      {sorted.map((d) => {
        const pct = ratio(d.seconds, total)
        return (
          <div key={d.category} className={styles.barRow}>
            <span className={styles.barLabel}>
              {t(CATEGORY_LABEL[d.category as Category] ?? d.category)}
            </span>
            <span className={styles.barTrack}>
              <span
                className={styles.barFill}
                data-cat={d.category}
                style={{ width: `${pct * 100}%` }}
              />
            </span>
            <span className={styles.barValue}>
              {Math.round(pct * 100)}% · {formatDuration(d.seconds)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
//  4. 7×24 时段热力（识别黄金专注时段）
// ============================================================
//  ⚠️ 星期名不写死在这里：单字「日/一/…」在英文界面下会漏译，
//     统一走 shared/i18n 的 weekdayLabel（中文 周一 / 英文 Mon）。
export function HourHeatmap({ data }: { data: number[][] }) {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const [hover, setHover] = useState<{ day: number; hour: number; v: number } | null>(null)
  const max = Math.max(1, ...data.flat())
  const cell = 18
  const gap = 2
  const dayName = (d: number): string => weekdayLabel(d, lang, lang === 'zh')

  return (
    <div className={styles.chartWrap}>
      {hover && (
        <div className={styles.tooltip}>
          {t('{day} {hour}:00 · {min} 分钟', {
            day: dayName(hover.day),
            hour: hover.hour,
            min: Math.round(hover.v)
          })}
        </div>
      )}
      <svg
        width={24 * (cell + gap) + 20}
        height={7 * (cell + gap) + 14}
        role="img"
        aria-label={t('时段热力图')}
      >
        {Array.from({ length: 24 }).map((_, hour) => (
          <text key={hour} x={20 + hour * (cell + gap)} y={10} className={styles.axisText}>
            {hour % 3 === 0 ? hour : ''}
          </text>
        ))}
        {data.map((row, day) => (
          <g key={day}>
            <text x={0} y={20 + day * (cell + gap) + cell - 4} className={styles.axisText}>
              {dayName(day)}
            </text>
            {row.map((v, hour) => (
              <rect
                key={hour}
                x={20 + hour * (cell + gap)}
                y={20 + day * (cell + gap)}
                width={cell}
                height={cell}
                rx={3}
                fill={v === 0 ? 'var(--surface-2)' : 'var(--accent)'}
                opacity={v === 0 ? 1 : 0.2 + ratio(v, max) * 0.8}
                onMouseEnter={() => setHover({ day, hour, v })}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        ))}
      </svg>
    </div>
  )
}

// ============================================================
//  5. 时间流向图（一天 24h 横向堆叠条）
// ============================================================
export function TimeFlow({ data }: { data: { category: string; seconds: number }[][] }) {
  const t = useT()
  const totals = data.map((col) => col.reduce((a, c) => a + c.seconds, 0))
  const max = Math.max(1, ...totals)
  const categories = [...new Set(data.flat().map((c) => c.category))]

  return (
    <div className={styles.flow}>
      {data.map((col, hour) => {
        const total = totals[hour]
        return (
          <div key={hour} className={styles.flowRow} title={t('{hour}:00 · {min} 分钟', { hour, min: Math.round(total / 60) })}>
            <span className={styles.flowHour}>{hour}</span>
            <span className={styles.flowTrack}>
              {total === 0 ? (
                <span className={styles.flowEmpty} />
              ) : (
                categories.map((cat) => {
                  const cell = col.find((c) => c.category === cat)
                  if (!cell || cell.seconds === 0) return null
                  const w = (cell.seconds / total) * ratio(total, max) * 100
                  return (
                    <span
                      key={cat}
                      className={styles.flowSeg}
                      data-cat={cat}
                      style={{ width: `${w}%` }}
                    />
                  )
                })
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
//  6. 番茄完成时段节律
// ============================================================
export function DaypartRing({
  data
}: {
  data: { part: 'morning' | 'afternoon' | 'evening'; count: number }[]
}) {
  const t = useT()
  const total = data.reduce((a, d) => a + d.count, 0)
  const LABEL = { morning: '上午', afternoon: '下午', evening: '晚间' }
  const COLOR = {
    morning: 'var(--warning)',
    afternoon: 'var(--accent)',
    evening: 'var(--focus)'
  }

  if (total === 0) return <p className={styles.noData}>{t('暂无数据')}</p>

  return (
    <div className={styles.dayparts}>
      {data.map((d) => (
        <div key={d.part} className={styles.daypart}>
          <span
            className={styles.daypartBar}
            style={{ height: `${ratio(d.count, total) * 100}%`, background: COLOR[d.part] }}
          />
          <span className={styles.daypartValue}>{d.count}</span>
          <span className={styles.daypartLabel}>{t(LABEL[d.part])}</span>
        </div>
      ))}
    </div>
  )
}

// ============================================================
//  指标卡
// ============================================================
export function MetricCards({ stats }: { stats: StatRangePayload }) {
  const t = useT()
  const cards = [
    { label: '完成番茄', value: `${stats.focusCount}`, unit: '个' },
    { label: '专注总时长', value: (stats.focusSeconds / 3600).toFixed(1), unit: '小时' },
    { label: '完成率', value: `${Math.round(stats.completionRate * 100)}`, unit: '%' },
    {
      label: '日均专注',
      value: (stats.avgFocusSecondsPerDay / 60).toFixed(0),
      unit: '分钟'
    }
  ]
  return (
    <div className={styles.metrics}>
      {cards.map((c) => (
        <div key={c.label} className={styles.metric}>
          <span className={styles.metricLabel}>{t(c.label)}</span>
          <span className={styles.metricValue}>
            {c.value}
            <em>{t(c.unit)}</em>
          </span>
        </div>
      ))}
    </div>
  )
}
