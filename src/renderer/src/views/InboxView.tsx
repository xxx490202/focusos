// ============================================================
//  InboxView.tsx — 收件箱 + 快速添加 + 搜索
// ============================================================
import { useMemo, useState } from 'react'
import { TaskCard } from '../components/sidebar/TaskCard'
import { EmptyState } from '../components/common/EmptyState'
import { IconInbox, IconPlus, IconClose } from '../components/common/Icons'
import { useDataStore } from '../stores/useDataStore'
import { useUIStore, todayKey } from '../stores/useUIStore'
import { smartParse, type ParsedDraft } from '@shared/smart-parse'
import { minutesToTime, nextFreeSlot } from '@shared/schedule'
import { useCreateTask, occupiedRanges } from '../hooks/useCreateTask'
import type { Task } from '@shared/types'
import { useT } from '../i18n'
import styles from './InboxView.module.css'

export function InboxView() {
  const t = useT()
  const tasks = useDataStore((s) => s.tasks)
  const settings = useDataStore((s) => s.settings)
  const reload = useDataStore((s) => s.reload)
  const search = useUIStore((s) => s.search)
  const setSearch = useUIStore((s) => s.setSearch)
  const searchOpen = useUIStore((s) => s.searchOpen)
  const toggleSearch = useUIStore((s) => s.toggleSearch)
  const openTaskModal = useUIStore((s) => s.openTaskModal)
  const toast = useUIStore((s) => s.toast)
  /** 新建走统一入口：时段与已有安排撞车时先弹确认框 */
  const createTask = useCreateTask()

  const [input, setInput] = useState('')
  const [draft, setDraft] = useState<ParsedDraft | null>(null)

  /*
   * 未排期任务；搜索时同时搜已排期任务。
   *
   * ⭐ 列表口径 = 「还没落定的东西」：
   *    · date === null           → 完全没排期
   *    · pending === true        → 已经排了时段但用户还没点确认
   *    用户明确要求待确认的任务**收件箱里也要出现**（时间轴上同时也能看到）。
   *    点掉时间轴上的空心圆后它会从这份列表里自然消失。
   */
  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = tasks.filter((t) => t.status !== 'archived')
    const filtered = q
      ? base.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
            (t.note ?? '').toLowerCase().includes(q)
        )
      : base.filter((t) => t.date === null || t.pending === true)
    return filtered.sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt)
  }, [tasks, search])

  // 实时解析输入，给出可确认的候选 chips
  const onInputChange = (value: string) => {
    setInput(value)
    setDraft(value.trim() ? smartParse(value) : null)
  }

  const removeChip = (index: number) => {
    if (!draft) return
    const chips = draft.chips.filter((_, i) => i !== index)
    // ⭐ 优雅降级：移除某个 chip 后仍然可用
    setDraft({ ...draft, chips, matched: chips.length > 0 })
  }

  const submit = async () => {
    const raw = input.trim()
    if (!raw) return
    const parsed = draft ?? smartParse(raw)

    /*
     * ⭐ 用户反馈「新建任务咋就会直接出现在今日日程上了？」
     *    现在的处理是：它**仍然**落到今日日程上，但以「待确认」态出现
     *    （灰字 + 空心圆），并且必须点掉空心圆才算真正排定；
     *    同时它也会留在收件箱列表里，直到被确认。
     *    没解析出日期时，挑一个不与已有安排重叠的空档，避免两个块叠在一起。
     */
    let date = parsed.date
    let startTime = parsed.startTime
    let endTime = parsed.endTime
    if (date === null) {
      date = todayKey()
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
      const free = nextFreeSlot(occupiedRanges(tasks, date), settings.defaultTaskMinutes, nowMin)
      startTime = minutesToTime(free.startMin)
      endTime = minutesToTime(free.endMin)
    }

    const outcome = await createTask(
      {
        title: parsed.title || raw,
        date,
        startTime,
        endTime,
        priority: parsed.priority,
        tags: parsed.tags,
        // 默认进收件箱、优先级中、estimatedPomodoros = 1
        estimatedPomodoros: 1
      },
      {
        successMessage: parsed.matched ? t('已创建并解析出日程信息') : t('已创建，等待确认')
      }
    )
    if (outcome === 'failed') return
    setInput('')
    setDraft(null)
  }

  // ---------------- 操作 ----------------
  const onEdit = (id: string) => openTaskModal(id)
  const onComplete = async (id: string) => {
    const r = await window.api.task.complete(id)
    if (!r.ok) toast(r.error, 'error')
    await reload()
  }
  const onDuplicate = async (id: string) => {
    const r = await window.api.task.duplicate(id)
    if (!r.ok) toast(r.error, 'error')
    await reload()
  }
  const onArchive = async (id: string) => {
    const r = await window.api.task.archive(id)
    if (!r.ok) toast(r.error, 'error')
    await reload()
  }
  const onDelete = async (id: string) => {
    const r = await window.api.task.remove(id)
    if (!r.ok) toast(r.error, 'error')
    await reload()
  }
  const onPlan = (id: string) => {
    void id
    toast(t('请先到日视图选择时间窗后生成计划'))
    useUIStore.getState().setView('day')
  }

  return (
    <div className={styles.root}>
      {/* 顶栏同时是窗口拖拽区（macOS 无原生标题栏）。
          交互控件由 global.css 的 [data-drag] 规则自动退出拖拽区。 */}
      <header className={styles.bar} data-drag="1">
        <h2 className={styles.title}>{search ? t('搜索结果') : t('收件箱')}</h2>
        <div className={styles.barRight}>
          {search && <span className={styles.count}>{t('{n} 项', { n: list.length })}</span>}
          <button className={styles.iconBtn} onClick={toggleSearch} aria-pressed={searchOpen}>
            {searchOpen ? <IconClose size={15} /> : <IconInbox size={15} />}
          </button>
        </div>
      </header>

      {searchOpen && (
        <div className={styles.searchBox}>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('按标题 / 标签 / 备注过滤')}
            aria-label={t('搜索')}
          />
        </div>
      )}

      {/* 快速添加 */}
      <div className={styles.quickAdd}>
        <input
          className={styles.quickInput}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            // 所有快捷键在 input 聚焦时失效，故此处自行处理回车
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
            if (e.key === 'Escape') {
              setInput('')
              setDraft(null)
            }
          }}
          placeholder={t('快速添加，例如：明天下午3点 和张三 开会 1小时 重要')}
          aria-label={t('快速添加任务')}
        />
        <button className={styles.addBtn} onClick={() => void submit()} disabled={!input.trim()}>
          <IconPlus size={15} />
        </button>

        {/* 解析出的候选 chips，可点 × 移除 */}
        {draft && draft.matched && (
          <div className={styles.chips}>
            {draft.chips.map((chip, i) => (
              <span key={`${chip.kind}-${i}`} className={styles.chip} data-kind={chip.kind}>
                {chip.label}
                <button
                  className={styles.chipX}
                  onClick={() => removeChip(i)}
                  aria-label={t('移除 {label}', { label: chip.label })}
                >
                  <IconClose size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 列表 */}
      <div className={styles.list}>
        {list.length === 0 ? (
          <EmptyState
            icon={<IconInbox size={28} />}
            title={search ? t('没有匹配的任务') : t('收件箱是空的')}
            desc={
              search
                ? t('换个关键词试试，搜索会同时匹配标题、标签和备注。')
                : t('把还没想好时间的事先丢进来，之后再拖到日历上排期。')
            }
            action={
              search
                ? { label: t('清除搜索'), onClick: () => setSearch('') }
                : { label: t('新建任务'), onClick: () => openTaskModal() }
            }
          />
        ) : (
          list.map((task: Task, i) => (
            <TaskCard
              key={task.id}
              task={task}
              index={i}
              onEdit={onEdit}
              onComplete={onComplete}
              onDuplicate={onDuplicate}
              onArchive={onArchive}
              onDelete={onDelete}
              onPlan={onPlan}
            />
          ))
        )}
      </div>
    </div>
  )
}
