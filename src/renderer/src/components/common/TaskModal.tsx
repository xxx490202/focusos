// ============================================================
//  TaskModal.tsx — 任务编辑模态框
// ============================================================
import { useEffect, useState } from 'react'
import { useDataStore } from '../../stores/useDataStore'
import { useUIStore, todayKey } from '../../stores/useUIStore'
import { CATEGORY_LABEL, PRIORITY_LABEL, REPEAT_LABEL } from '@shared/defaults'
import type { Task, Priority, Category, RepeatRule } from '@shared/types'
import { minutesToTime, nextFreeSlot } from '@shared/schedule'
import { useCreateTask, occupiedRanges } from '../../hooks/useCreateTask'
import { useT } from '../../i18n'
import styles from './TaskModal.module.css'

export function TaskModal() {
  const open = useUIStore((s) => s.taskModalOpen)
  const editingId = useUIStore((s) => s.editingTaskId)
  const close = useUIStore((s) => s.closeTaskModal)
  const toast = useUIStore((s) => s.toast)
  const tasks = useDataStore((s) => s.tasks)
  const settings = useDataStore((s) => s.settings)
  const reload = useDataStore((s) => s.reload)
  const t = useT()
  /** 新建走统一入口：时段与已有安排撞车时先弹确认框 */
  const createTask = useCreateTask()

  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState<string | null>(todayKey())
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [priority, setPriority] = useState<Priority>(1)
  const [category, setCategory] = useState<Category>('work')
  const [repeat, setRepeat] = useState<RepeatRule>('none')
  const [estimated, setEstimated] = useState(1)
  const [tags, setTags] = useState('')
  const [checklist, setChecklist] = useState<Task['checklist']>([])
  const [newItem, setNewItem] = useState('')

  // 打开时载入数据
  useEffect(() => {
    if (!open) return
    const existing = editingId ? tasks.find((t) => t.id === editingId) : null

    if (existing) {
      setTitle(existing.title)
      setNote(existing.note ?? '')
      setDate(existing.date)
      setStartTime(existing.startTime ?? '09:00')
      setEndTime(existing.endTime ?? minutesToTime(minutesOf(existing.startTime ?? '09:00') + settings.defaultTaskMinutes))
      setPriority(existing.priority)
      setCategory(existing.category)
      setRepeat(existing.repeat)
      setEstimated(existing.estimatedPomodoros)
      setTags(existing.tags.join(' '))
      setChecklist(existing.checklist)
      return
    }

    // 新建：可能带来自日视图双击的时段
    const slotRaw = sessionStorage.getItem('focusos:newTaskSlot')
    sessionStorage.removeItem('focusos:newTaskSlot')
    if (slotRaw) {
      try {
        const slot = JSON.parse(slotRaw) as { date: string; startTime: string; endTime: string }
        setDate(slot.date)
        setStartTime(slot.startTime)
        setEndTime(slot.endTime)
      } catch {
        // 忽略损坏的 slot
      }
    } else {
      /*
       * 没指定时段 → 落今天、并且挑一个**不与已有安排重叠**的空档。
       * ⚠️ 早点写死 09:00–10:00 会让新任务直接压在别人的日程上，
       *    而新建出来的是「待确认」态，两个块叠在一起根本分不清谁是谁。
       */
      const today = todayKey()
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
      const free = nextFreeSlot(occupiedRanges(tasks, today), settings.defaultTaskMinutes, nowMin)
      setDate(today)
      setStartTime(minutesToTime(free.startMin))
      setEndTime(minutesToTime(free.endMin))
    }
    setTitle('')
    setNote('')
    setPriority(1)
    setCategory('work')
    setRepeat('none')
    setEstimated(1)
    setTags('')
    setChecklist([])
  }, [open, editingId, tasks, settings.defaultTaskMinutes])

  // Esc 关闭（即使在 input 聚焦时也生效）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const submit = async () => {
    if (!title.trim()) {
      toast(t('请填写任务标题'), 'error')
      return
    }
    const patch: Partial<Task> = {
      title: title.trim(),
      note: note.trim() || undefined,
      date,
      priority,
      category,
      repeat,
      estimatedPomodoros: estimated,
      tags: tags.split(/[\s,，]+/).filter(Boolean),
      checklist,
      ...(date !== null
        ? { startTime, endTime: endTime > startTime ? endTime : undefined }
        : { startTime: undefined, endTime: undefined })
    }

    if (editingId) {
      const r = await window.api.task.update(editingId, patch)
      if (!r.ok) {
        toast(r.error, 'error')
        return
      }
      await reload()
      toast(t('已保存'), 'success')
      close()
      return
    }

    /*
     * 新建统一走 useCreateTask：
     * 时段与已有安排重叠时它会先弹确认框（返回 'confirming'），
     * 两种情况都要关掉本弹窗 —— 留着会让表单被后续 reload 重置成空白。
     */
    const outcome = await createTask(patch, { successMessage: t('已创建，等待确认') })
    if (outcome !== 'failed') close()
  }

  return (
    <div className={styles.mask} onClick={close}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>{editingId ? t('编辑任务') : t('新建任务')}</h3>

        <div className={styles.field}>
          <label>{t('标题')}</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('要做什么？')}
          />
        </div>

        <div className={styles.field}>
          <label>{t('备注')}</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t('补充说明（可选）')}
          />
        </div>

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label>{t('日期')}</label>
            <div className={styles.row}>
              <input
                type="date"
                value={date ?? ''}
                onChange={(e) => setDate(e.target.value || null)}
              />
              {date !== null && (
                <button className={styles.clearBtn} onClick={() => setDate(null)}>
                  {t('移回收件箱')}
                </button>
              )}
            </div>
          </div>
          <div className={styles.field}>
            <label>{t('重复')}</label>
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatRule)}>
              {(Object.keys(REPEAT_LABEL) as RepeatRule[]).map((r) => (
                <option key={r} value={r}>
                  {t(REPEAT_LABEL[r])}
                </option>
              ))}
            </select>
          </div>
        </div>

        {date !== null && (
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label>{t('开始')}</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>{t('结束')}</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
        )}

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label>{t('分类')}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                <option key={c} value={c}>
                  {t(CATEGORY_LABEL[c])}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>{t('优先级')}</label>
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
              {([0, 1, 2] as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {t(PRIORITY_LABEL[p])}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label>{t('预计番茄数')}</label>
            <input
              type="number"
              min={0}
              max={50}
              value={estimated}
              onChange={(e) => setEstimated(Math.max(0, Math.min(50, Number(e.target.value))))}
            />
          </div>
          <div className={styles.field}>
            <label>{t('标签（空格分隔）')}</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('工作 写作')} />
          </div>
        </div>

        {/* checklist */}
        <div className={styles.field}>
          <label>{t('子任务')}</label>
          {checklist.map((c) => (
            <div key={c.id} className={styles.checkItem}>
              <input
                type="checkbox"
                checked={c.done}
                onChange={(e) =>
                  setChecklist(
                    checklist.map((x) =>
                      x.id === c.id ? { ...x, done: e.target.checked } : x
                    )
                  )
                }
              />
              <input
                className={styles.checkText}
                value={c.text}
                onChange={(e) =>
                  setChecklist(checklist.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))
                }
              />
              <button
                className={styles.checkDel}
                onClick={() => setChecklist(checklist.filter((x) => x.id !== c.id))}
              >
                ×
              </button>
            </div>
          ))}
          <div className={styles.row}>
            <input
              value={newItem}
              placeholder={t('添加子任务后回车')}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                const t = newItem.trim()
                if (!t) return
                setChecklist([
                  ...checklist,
                  { id: `ci_${Date.now().toString(36)}_${checklist.length}`, text: t, done: false }
                ])
                setNewItem('')
              }}
            />
          </div>
        </div>

        <div className={styles.ops}>
          <button className={styles.btnGhost} onClick={close}>
            {t('取消')}
          </button>
          <button className={styles.btnPrimary} onClick={() => void submit()}>
            {editingId ? t('保存') : t('创建')}
          </button>
        </div>
      </div>
    </div>
  )
}

function minutesOf(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 540
}
