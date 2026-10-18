// ============================================================
//  HabitDialog.tsx — 新建 / 编辑习惯
// ============================================================
import { useState } from 'react'
import { useDataStore } from '../../stores/useDataStore'
import { useUIStore } from '../../stores/useUIStore'
import type { Habit, HabitType } from '@shared/types'
import { useT } from '../../i18n'
import styles from './HabitDialog.module.css'

interface Props {
  /** null = 新建 */
  habit: Habit | null
  onClose: () => void
}

export function HabitDialog({ habit, onClose }: Props) {
  const reload = useDataStore((s) => s.reload)
  const toast = useUIStore((s) => s.toast)
  const t = useT()

  const [title, setTitle] = useState(habit?.title ?? '')
  const [type, setType] = useState<HabitType>(habit?.type ?? 'click')
  /*
   * ⚠️ 秒表型的目标在界面上按**分钟**填，存的时候换算成秒。
   *    让用户填「1200」秒是反直觉的；数据层统一用秒则是为了让连续天数的
   *    达标判定只有一套口径。
   */
  const [target, setTarget] = useState(() => {
    if (!habit) return 1
    return habit.type === 'stopwatch' ? Math.max(1, Math.round(habit.dailyTarget / 60)) : habit.dailyTarget
  })
  const [needTarget, setNeedTarget] = useState(habit?.streakNeedsTarget ?? true)

  const submit = async (): Promise<void> => {
    const name = title.trim()
    if (!name) {
      toast(t('请填写习惯名称'), 'error')
      return
    }
    const dailyTarget =
      type === 'stopwatch'
        ? Math.max(60, Math.round(target) * 60)
        : Math.max(1, Math.round(target))

    const patch = { title: name, type, dailyTarget, streakNeedsTarget: needTarget }
    const r = habit
      ? await window.api.habit.update(habit.id, patch)
      : await window.api.habit.create(patch)
    if (!r.ok) {
      toast(r.error ?? t('操作失败'), 'error')
      return
    }
    await reload()
    toast(habit ? t('已保存') : t('已创建'), 'success')
    onClose()
  }

  return (
    <div className={styles.mask} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
      >
        <h2 className={styles.title}>{habit ? t('编辑习惯') : t('新增习惯')}</h2>

        <label className={styles.field}>
          <span>{t('名称')}</span>
          <input
            autoFocus
            value={title}
            maxLength={40}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('例如：喝水 / 冥想')}
          />
        </label>

        <div className={styles.field}>
          <span>{t('类型')}</span>
          <div className={styles.segGroup}>
            <button
              type="button"
              className={styles.segBtn}
              data-active={type === 'click' ? 'true' : 'false'}
              onClick={() => setType('click')}
            >
              {t('点击计数')}
            </button>
            <button
              type="button"
              className={styles.segBtn}
              data-active={type === 'stopwatch' ? 'true' : 'false'}
              onClick={() => setType('stopwatch')}
            >
              {t('计时累计')}
            </button>
          </div>
        </div>

        <label className={styles.field}>
          <span>{type === 'stopwatch' ? t('每日目标（分钟）') : t('每日目标（次）')}</span>
          <input
            type="number"
            min={1}
            max={type === 'stopwatch' ? 600 : 1000}
            value={target}
            onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={needTarget}
            onChange={(e) => setNeedTarget(e.target.checked)}
          />
          <span>{t('连续打卡按「达到目标」判定（关掉则只要做过就算）')}</span>
        </label>

        <div className={styles.ops}>
          <button className={styles.btnGhost} onClick={onClose}>
            {t('取消')}
          </button>
          <button className={styles.btnPrimary} onClick={() => void submit()}>
            {habit ? t('保存') : t('创建')}
          </button>
        </div>
      </div>
    </div>
  )
}
