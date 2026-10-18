// ============================================================
//  HabitStrip.tsx — 习惯打卡条（放在洞察页顶部）
// ============================================================
//  两种类型：
//   · click     点一下 +1（喝水、俯卧撑…）
//   · stopwatch 计时累计（冥想、阅读…），停止时才落库
//
//  ⚠️ 秒表型**不能每秒落库**：repository.write 会把整份数据文件重写一遍，
//     每秒一次等于持续把磁盘写爆。所以计时期间只在本组件里累加，
//     停止 / 组件卸载时才写一次。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDataStore } from '../../stores/useDataStore'
import { useUIStore, todayKey } from '../../stores/useUIStore'
import { habitRecentDays, habitStreak, habitValueOn, isHabitDoneOn } from '@shared/habits'
import type { Habit } from '@shared/types'
import { useT } from '../../i18n'
import { IconCheck, IconPencil, IconPlay, IconPlus } from '../common/Icons'
import { HabitDialog } from './HabitDialog'
import styles from './HabitStrip.module.css'

export function HabitStrip() {
  const habits = useDataStore((s) => s.habits)
  const reload = useDataStore((s) => s.reload)
  const toast = useUIStore((s) => s.toast)
  const openConfirm = useUIStore((s) => s.askConfirm)
  const t = useT()
  const today = todayKey()

  /** 正在计时的习惯：id → 开始时刻（ms）。null 表示没在计时 */
  const [startedAt, setStartedAt] = useState<Record<string, number>>({})
  /** 只为秒表刷新显示用的心跳 */
  const [, forceTick] = useState(0)
  /** 正在编辑/新建的习惯；'new' 表示新建 */
  const [editing, setEditing] = useState<Habit | 'new' | null>(null)

  const runningKey = Object.keys(startedAt).join(',')

  useEffect(() => {
    if (!runningKey) return
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [runningKey])

  /** 秒表显示值 = 已存值 + 本次未落库的秒数 */
  const liveValue = useCallback(
    (habit: Habit): number => {
      const base = habitValueOn(habit, today)
      const start = startedAt[habit.id]
      if (start === undefined) return base
      return base + Math.floor((Date.now() - start) / 1000)
    },
    [startedAt, today]
  )

  const setValue = useCallback(
    async (id: string, value: number) => {
      const r = await window.api.habit.setValue(id, today, Math.max(0, Math.round(value)))
      if (!r.ok) {
        toast(r.error ?? t('保存失败'), 'error')
        return
      }
      await reload()
    },
    [today, toast, reload, t]
  )

  const stopStopwatch = useCallback(
    async (habit: Habit) => {
      const value = liveValue(habit)
      setStartedAt((prev) => {
        const next = { ...prev }
        delete next[habit.id]
        return next
      })
      await setValue(habit.id, value)
    },
    [liveValue, setValue]
  )

  /*
   * 组件卸载时把还在跑的秒表落库。
   * 不这么做的话，用户开着秒表切走视图，这段时间就白计了。
   */
  useEffect(() => {
    return () => {
      const ids = Object.keys(startedAt)
      if (ids.length === 0) return
      for (const id of ids) {
        const habit = habits.find((h) => h.id === id)
        if (!habit) continue
        const value =
          habitValueOn(habit, today) + Math.floor((Date.now() - (startedAt[id] ?? Date.now())) / 1000)
        void window.api.habit.setValue(id, today, Math.max(0, value))
      }
    }
    // 只在卸载时执行一次；startedAt 用 ref 语义读取会引入额外复杂度，
    // 这里刻意不把它放进依赖（放进去会每加一个计时就拆一次）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remove = (habit: Habit): void => {
    openConfirm({
      title: t('删除习惯'),
      message: t('确定删除「{title}」吗？它的打卡记录也会一起删掉。', { title: habit.title }),
      confirmLabel: t('删除'),
      danger: true,
      onConfirm: async () => {
        const r = await window.api.habit.remove(habit.id)
        if (!r.ok) {
          toast(r.error ?? t('删除失败'), 'error')
          return
        }
        await reload()
        toast(t('已删除'), 'success')
      }
    })
  }

  const chips = useMemo(
    () => habits.map((habit) => ({ habit, streak: habitStreak(habit, today) })),
    [habits, today]
  )

  return (
    <section className={styles.root} data-testid="habit-strip">
      <header className={styles.head}>
        <h3 className={styles.title}>{t('习惯打卡')}</h3>
        <button className={styles.addBtn} onClick={() => setEditing('new')}>
          <IconPlus size={13} />
          <span>{t('新增习惯')}</span>
        </button>
      </header>

      {chips.length === 0 ? (
        <p className={styles.empty}>{t('还没有习惯。记一件想每天坚持的小事吧。')}</p>
      ) : (
        <div className={styles.list}>
          {chips.map(({ habit, streak }) => {
            const value = habit.type === 'stopwatch' ? liveValue(habit) : habitValueOn(habit, today)
            const done = isHabitDoneOn(habit, today)
            const running = startedAt[habit.id] !== undefined
            const days = habitRecentDays(habit, today, 14)

            return (
              <div key={habit.id} className={styles.card} data-done={done ? 'true' : 'false'}>
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>{habit.title}</span>
                  {streak > 0 && (
                    <span className={styles.streak} title={t('连续打卡 {n} 天', { n: streak })}>
                      🔥 {streak}
                    </span>
                  )}
                </div>

                <div className={styles.cardValue}>
                  <strong>{habit.type === 'stopwatch' ? formatClock(value) : value}</strong>
                  <span className={styles.target}>/ {habit.type === 'stopwatch' ? formatClock(habit.dailyTarget) : habit.dailyTarget}</span>
                </div>

                {/* 最近 14 天达标情况：一眼看出有没有断 */}
                <div className={styles.spark} aria-hidden="true">
                  {days.map((ok, i) => (
                    <span key={i} className={styles.sparkDot} data-on={ok ? 'true' : 'false'} />
                  ))}
                </div>

                <div className={styles.cardOps}>
                  {habit.type === 'click' ? (
                    <button
                      className={styles.mainBtn}
                      data-done={done ? 'true' : 'false'}
                      onClick={() => void setValue(habit.id, value + 1)}
                    >
                      <IconPlus size={13} />
                      {t('+1')}
                    </button>
                  ) : (
                    <button
                      className={styles.mainBtn}
                      data-done={running ? 'true' : 'false'}
                      onClick={() => {
                        if (running) void stopStopwatch(habit)
                        else setStartedAt((p) => ({ ...p, [habit.id]: Date.now() }))
                      }}
                    >
                      {running ? <IconCheck size={13} /> : <IconPlay size={13} />}
                      {running ? t('停止') : t('开始')}
                    </button>
                  )}
                  <button className={styles.iconBtn} onClick={() => setEditing(habit)} title={t('编辑')}>
                    <IconPencil size={13} />
                  </button>
                  <button
                    className={styles.iconBtn}
                    data-danger="true"
                    onClick={() => remove(habit)}
                    title={t('删除')}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <HabitDialog
          habit={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

/** 秒表数值显示成 mm:ss（超过一小时按 hh:mm:ss） */
function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
