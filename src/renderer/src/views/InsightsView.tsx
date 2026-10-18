// ============================================================
//  InsightsView.tsx — 洞察统计
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import {
  MetricCards, BarChart, CategoryBars, HourHeatmap,
  YearHeatmap, DaypartRing, TimeFlow
} from '../components/charts/Charts'
import { EmptyState } from '../components/common/EmptyState'
import { HabitStrip } from '../components/habits/HabitStrip'
import { IconChart, IconCopy, IconDownload } from '../components/common/Icons'
import { useUIStore } from '../stores/useUIStore'
import { formatDuration } from '@shared/schedule'
import type { StatRangePayload, TaskTopPayload } from '@shared/ipc-contract'
import { useT } from '../i18n'
import styles from './InsightsView.module.css'

type Granularity = 'today' | 'week' | 'month'

const RANGES: Record<Granularity, { label: string; days: number }> = {
  today: { label: '今日', days: 1 },
  week: { label: '本周', days: 7 },
  month: { label: '本月', days: 30 }
}

export function InsightsView() {
  const t = useT()
  const [g, setG] = useState<Granularity>('week')
  const [stats, setStats] = useState<StatRangePayload | null>(null)
  const [top, setTop] = useState<TaskTopPayload[]>([])
  const [report, setReport] = useState('')
  const toast = useUIStore((s) => s.toast)

  const range = useMemo(() => {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - (RANGES[g].days - 1))
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { from: key(from), to: key(to) }
  }, [g])

  useEffect(() => {
    let cancelled = false
    void window.api.stats.range(range.from, range.to).then((r) => {
      if (cancelled) return
      if (r.ok) setStats(r.data)
    })
    void window.api.stats.top(range.from, range.to).then((r) => {
      if (cancelled) return
      if (r.ok) setTop(r.data)
    })
    return () => {
      cancelled = true
    }
  }, [range])

  const hasData = (stats?.focusCount ?? 0) > 0

  return (
    <div className={styles.root}>
      {/* 顶栏同时是窗口拖拽区（macOS 无原生标题栏）。
          交互控件由 global.css 的 [data-drag] 规则自动退出拖拽区。 */}
      <header className={styles.bar} data-drag="1">
        <h2 className={styles.title}>{t('洞察')}</h2>
        <div className={styles.granularity}>
          {(Object.keys(RANGES) as Granularity[]).map((k) => (
            <button
              key={k}
              className={styles.granBtn}
              data-active={g === k ? 'true' : 'false'}
              onClick={() => setG(k)}
            >
              {t(RANGES[k].label)}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.scroll}>
        {/*
          习惯打卡放在 hasData 判断**之外**：
          它记的是喝水/冥想这类日常小事，跟有没有跑过番茄没关系 ——
          一个还没开始专注的新用户也应该能用起来。
        */}
        <div className={styles.habitWrap}>
          <HabitStrip />
        </div>

        {!stats || !hasData ? (
          <EmptyState
            icon={<IconChart size={28} />}
            title={t('这段时间还没有专注记录')}
            desc={t('完成一个番茄后，这里会自动出现完成数、时段分布和分类占比。')}
          />
        ) : (
          <div className={styles.grid}>
            <section className={styles.full}>
              <MetricCards stats={stats} />
            </section>

            <section className={styles.full}>
              <h3 className={styles.sectionTitle}>{t('近 14 日完成数')}</h3>
              <div className={styles.card}>
                <BarChart data={stats.daily} />
              </div>
            </section>

            <section>
              <h3 className={styles.sectionTitle}>{t('时段热力')}</h3>
              <div className={styles.card}>
                <HourHeatmap data={stats.heatmap} />
              </div>
            </section>

            <section>
              <h3 className={styles.sectionTitle}>{t('分类占比')}</h3>
              <div className={styles.card}>
                <CategoryBars data={stats.byCategory} />
              </div>
            </section>

            <section>
              <h3 className={styles.sectionTitle}>{t('番茄节律')}</h3>
              <div className={styles.card}>
                <DaypartRing data={stats.dayparts} />
              </div>
            </section>

            <section>
              <h3 className={styles.sectionTitle}>{t('时间流向')}</h3>
              <div className={styles.card}>
                {stats.flow && stats.flow.length > 0 ? (
                  <TimeFlow data={stats.flow} />
                ) : (
                  <TimeFlow
                    data={Array.from({ length: 24 }, () =>
                      stats.byCategory.map((c) => ({ category: c.category, seconds: 0 }))
                    )}
                  />
                )}
              </div>
            </section>

            <section className={styles.full}>
              <h3 className={styles.sectionTitle}>{t('近一年专注轨迹')}</h3>
              <div className={styles.card}>
                <YearHeatmap data={stats.year} />
              </div>
            </section>

            {top.length > 0 && (
              <section className={styles.full}>
                <h3 className={styles.sectionTitle}>{t('投入最多的任务')}</h3>
                <div className={styles.card}>
                  <ol className={styles.rank}>
                    {top.map((task, i) => (
                      <li key={task.taskId} className={styles.rankItem}>
                        <span className={styles.rankIndex}>{i + 1}</span>
                        <span className={styles.rankTitle}>{task.title}</span>
                        <span className={styles.rankValue}>
                          {formatDuration(task.seconds)} · {t('{n} 个番茄', { n: task.count })}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>
            )}

            <section className={styles.full}>
              <h3 className={styles.sectionTitle}>{t('周报')}</h3>
              <div className={styles.card}>
                {report ? (
                  <>
                    <pre className={styles.report}>{report}</pre>
                    <div className={styles.reportOps}>
                      <button
                        className={styles.btnGhost}
                        onClick={async () => {
                          await navigator.clipboard.writeText(report)
                          toast(t('周报已复制到剪贴板'), 'success')
                        }}
                      >
                        <IconCopy size={13} />
                        <span>{t('复制 Markdown')}</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    className={styles.btnPrimary}
                    onClick={async () => {
                      const r = await window.api.stats.weeklyReport(range.from, range.to)
                      if (r.ok) setReport(r.data)
                      else toast(r.error, 'error')
                    }}
                  >
                    <IconDownload size={13} />
                    <span>{t('生成周报')}</span>
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
