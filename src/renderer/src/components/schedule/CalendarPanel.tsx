// ============================================================
//  CalendarPanel.tsx — 通用日历面板
// ============================================================
//  ⭐ 今日日程与周视图**共用同一个日历**（用户明确要求「两页共用同一个面板」）。
//     因此这里不叫 MonthPicker 了 —— 它不再是周视图专属。
//
//  结构：
//    · 顶部一行：年 ‹ › ／ 月 ‹ › ／ 今天
//    · 星期表头：一 二 三 四 五 六 日（随 weekStartsOn 变化）
//    · 可上下滚动的多个月份网格（光标月 ± 2，共 5 个月）
//
//  两种高亮语义（mode）：
//    · week —— 落点所在的周 7 天全部高亮蓝色（周视图）
//    · day  —— 只高亮落点那一天（日视图）
//
//  ⚠️ 点击某天只改变选中项，**不关闭面板** ——
//     否则用户根本看不到「那几天变蓝」这个反馈。
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  monthGrid, isSameMonth, addDays, dateToUTC, startOfWeek, weekdayOrder
} from '@shared/schedule'
import { weekdayLabel, monthLabel, yearMonthLabel } from '@shared/i18n'
import { useT, useI18n } from '../../i18n'
import { IconChevronDown } from '../common/Icons'
import styles from './CalendarPanel.module.css'

interface Props {
  /** 当前落点日期：day 模式即选中日；week 模式取所在周 */
  anchorDate: string
  /** 高亮粒度 */
  mode: 'day' | 'week'
  weekStartsOn: 0 | 1
  today: string
  onPick: (date: string) => void
  onClose: () => void
  /** 面板锚点（相对视图根元素），默认贴在顶栏下方 */
  top?: number
  left?: number
}

interface Ym {
  y: number
  m: number
}

/** 光标月前后各展示 2 个月，形成可滚动的长列表 */
const SPAN = 2

export function CalendarPanel({
  anchorDate, mode, weekStartsOn, today, onPick, onClose, top, left
}: Props) {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const [cursor, setCursor] = useState<Ym>(() => {
    const d = dateToUTC(anchorDate)
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
  })

  const months = useMemo<Ym[]>(
    () =>
      Array.from({ length: SPAN * 2 + 1 }, (_, i) => {
        const d = new Date(cursor.y, cursor.m - SPAN + i, 1)
        return { y: d.getFullYear(), m: d.getMonth() }
      }),
    [cursor]
  )

  const bodyRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)

  // 光标月变化时把它滚到可视区顶部；打开时同理。
  // ⚠️ .body 设了 position: relative，因此 offsetTop 就是相对滚动容器的偏移。
  useEffect(() => {
    const body = bodyRef.current
    const center = centerRef.current
    if (!body || !center) return
    body.scrollTo({ top: center.offsetTop, behavior: 'smooth' })
  }, [cursor])

  // 外部点击 / Esc 关闭
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  /*
   * 高亮区间。
   * week：与 weekStartsOn 对齐的整周；day：就是落点那一天。
   */
  const [hlFrom, hlTo] = useMemo(() => {
    if (mode === 'day') return [anchorDate, anchorDate]
    const start = startOfWeek(anchorDate, weekStartsOn)
    return [start, addDays(start, 6)]
  }, [mode, anchorDate, weekStartsOn])

  const order = weekdayOrder(weekStartsOn)

  const shift = (dy: number, dm: number) => {
    const d = new Date(cursor.y + dy, cursor.m + dm, 1)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
  }

  const goToday = () => {
    const d = dateToUTC(today)
    setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() })
    onPick(today)
  }

  return (
    <div
      className={styles.panel}
      ref={rootRef}
      data-testid="calendar-panel"
      style={top !== undefined || left !== undefined ? { top, left } : undefined}
    >
      {/* ---------- 顶部：年 / 月 / 今天 ---------- */}
      <div className={styles.head}>
        {/* 年 / 月两组步进器同行，窄面板下自动换行 */}
        <div className={styles.headFields}>
          <div className={styles.headRow}>
            <span className={styles.headLabel}>{t('年')}</span>
            <button className={styles.step} onClick={() => shift(-1, 0)} aria-label={t('上一年')}>
              <IconChevronDown size={12} className={styles.up} />
            </button>
            <span className={styles.headValue}>{cursor.y}</span>
            <button className={styles.step} onClick={() => shift(1, 0)} aria-label={t('下一年')}>
              <IconChevronDown size={12} />
            </button>
          </div>

          <div className={styles.headRow}>
            <span className={styles.headLabel}>{t('月')}</span>
            <button className={styles.step} onClick={() => shift(0, -1)} aria-label={t('上个月')}>
              <IconChevronDown size={12} className={styles.up} />
            </button>
            <span className={styles.headValue}>
              {lang === 'zh' ? `${cursor.m + 1} 月` : monthLabel(cursor.m, lang)}
            </span>
            <button className={styles.step} onClick={() => shift(0, 1)} aria-label={t('下个月')}>
              <IconChevronDown size={12} />
            </button>
          </div>
        </div>

        {/* 「今天」独占一行并居中 */}
        <button className={styles.today} onClick={goToday}>
          {t('今天')}
        </button>
      </div>

      {/* ---------- 星期表头 ---------- */}
      <div className={styles.weekHead}>
        {order.map((dow) => (
          <span key={dow} className={styles.weekHeadCell}>
            {weekdayLabel(dow, lang)}
          </span>
        ))}
      </div>

      {/* ---------- 可滚动的月份列表 ---------- */}
      <div className={styles.body} ref={bodyRef}>
        {months.map((ym) => {
          const isCenter = ym.y === cursor.y && ym.m === cursor.m
          return (
            <div
              key={`${ym.y}-${ym.m}`}
              className={styles.month}
              ref={isCenter ? centerRef : undefined}
            >
              <div className={styles.monthTitle}>
                {yearMonthLabel(ym.y, ym.m, lang)}
              </div>
              <div className={styles.grid}>
                {monthGrid(ym.y, ym.m, weekStartsOn).map((key) => {
                  const inMonth = isSameMonth(key, ym.y, ym.m)
                  const selected = key >= hlFrom && key <= hlTo
                  return (
                    <button
                      key={key}
                      className={styles.cell}
                      data-out={inMonth ? 'false' : 'true'}
                      data-selected={selected ? 'true' : 'false'}
                      data-today={key === today ? 'true' : 'false'}
                      onClick={() => onPick(key)}
                      title={key}
                    >
                      {dateToUTC(key).getUTCDate()}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
