// ============================================================
//  TaskCard.tsx — 任务卡
// ============================================================
//  优先级色条、标题、🍅 2/5、checklist 进度、标签、时间、复现图标
// ============================================================
import type { Task } from '@shared/types'
import { PRIORITY_LABEL, REPEAT_LABEL } from '@shared/defaults'
import { useUIStore } from '../../stores/useUIStore'
import { useT } from '../../i18n'
import {
  IconCheck, IconEdit, IconCopy, IconArchive, IconTrash, IconRepeat, IconSparkle
} from '../common/Icons'
import styles from './TaskCard.module.css'

interface Props {
  task: Task
  index: number
  onEdit: (id: string) => void
  onComplete: (id: string) => void
  onDuplicate: (id: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  onPlan: (id: string) => void
  /** 拖到日历排期 */
  draggable?: boolean
}

export function TaskCard({
  task, index, onEdit, onComplete, onDuplicate, onArchive, onDelete, onPlan, draggable = true
}: Props) {
  const t = useT()
  const openTaskMenu = useUIStore((s) => s.openTaskMenu)
  const askConfirm = useUIStore((s) => s.askConfirm)

  const checklistDone = task.checklist.filter((c) => c.done).length
  const showChecklist = task.checklist.length > 0

  /**
   * 删除走统一确认流程。
   * ⚠️ 原实现用 window.confirm —— 它会阻塞渲染进程、样式不可控，
   *    且与「右键菜单里删也要确认」不是同一套交互。现已统一为应用内弹窗。
   */
  const askDelete = () =>
    askConfirm({
      title: t('删除任务'),
      message: t('确定删除「{title}」吗？此操作不可撤销。', { title: task.title }),
      confirmLabel: t('删除'),
      danger: true,
      onConfirm: () => {
        onDelete(task.id)
      }
    })

  return (
    <div
      className={styles.card}
      data-priority={task.priority}
      data-status={task.status}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-focusos-task', task.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openTaskMenu(task.id, e.clientX, e.clientY)
      }}
      style={{ animationDelay: `${index * 20}ms` }}
    >
      {/* 优先级色条 */}
      <span className={styles.priorityBar} aria-hidden="true" />

      <button
        className={styles.check}
        data-done={task.status === 'done' ? 'true' : 'false'}
        onClick={() => onComplete(task.id)}
        title={task.status === 'done' ? t('标记未完成') : t('标记完成')}
        aria-label={task.status === 'done' ? t('标记未完成') : t('标记完成')}
      >
        {task.status === 'done' && <IconCheck size={13} />}
      </button>

      <div className={styles.body}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{task.title}</span>
          {/* 待确认：时间轴上是一条灰块 + 空心圆，在收件箱列表里也要标识出来 */}
          {task.pending === true && <span className={styles.pendingTag}>{t('待确认')}</span>}
          <span className={styles.pomodoros}>
            🍅 {task.completedPomodoros}/{task.estimatedPomodoros}
          </span>
        </div>

        {showChecklist && (
          <div className={styles.checklist} title={`${checklistDone}/${task.checklist.length}`}>
            <span className={styles.checklistText}>
              {checklistDone}/{task.checklist.length}
            </span>
            <span className={styles.checklistBar} aria-hidden="true">
              <span
                className={styles.checklistFill}
                style={{ width: `${(checklistDone / task.checklist.length) * 100}%` }}
              />
            </span>
          </div>
        )}

        <div className={styles.meta}>
          <span className={styles.tag} data-cat={task.category}>
            {task.category}
          </span>
          <span className={styles.priority}>{t(PRIORITY_LABEL[task.priority])}</span>
          {task.repeat !== 'none' && (
            <span className={styles.metaItem} title={t(REPEAT_LABEL[task.repeat])}>
              <IconRepeat size={12} />
            </span>
          )}
          {task.startTime && (
            <span className={styles.metaItem}>
              {task.startTime}
              {task.endTime ? `–${task.endTime}` : ''}
            </span>
          )}
          {task.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              #{tag}
            </span>
          ))}
        </div>
      </div>

      {/* 操作：hover 浮现 */}
      <div className={styles.ops}>
        <button className={styles.opBtn} onClick={() => onPlan(task.id)} title={t('生成番茄计划')}>
          <IconSparkle size={14} />
        </button>
        <button className={styles.opBtn} onClick={() => onEdit(task.id)} title={t('编辑')}>
          <IconEdit size={14} />
        </button>
        <button className={styles.opBtn} onClick={() => onDuplicate(task.id)} title={t('复制副本')}>
          <IconCopy size={14} />
        </button>
        <button className={styles.opBtn} onClick={() => onArchive(task.id)} title={t('归档')}>
          <IconArchive size={14} />
        </button>
        <button
          className={styles.opBtn}
          data-danger="true"
          onClick={() => askDelete()}
          title={t('删除')}
        >
          <IconTrash size={14} />
        </button>
      </div>
    </div>
  )
}
