// ============================================================
//  Sidebar.tsx — 左侧 220px 侧栏 + 导航
// ============================================================
import { useMemo } from 'react'
import { useUIStore, todayKey } from '../../stores/useUIStore'
import { useDataStore } from '../../stores/useDataStore'
import { useT } from '../../i18n'
import {
  IconFocus, IconCalendar, IconWeek, IconInbox, IconChart, IconSettings,
  IconSearch, IconPlus, IconPanelLeft
} from '../common/Icons'
import type { ViewId } from '@shared/types'
import styles from './Sidebar.module.css'

/*
 * ⚠️ 「设置」**不在**这个列表里 —— 用户要求把它挪到侧栏最底部、
 *    字标「xyc design.」的下方，与上方导航项分隔开。
 *    但它仍复用 .navItem 样式，因此图标与文字的对齐方式和上面各项完全一致。
 */
const NAV: { id: ViewId; label: string; Icon: typeof IconFocus }[] = [
  { id: 'focus', label: '专注', Icon: IconFocus },
  { id: 'day', label: '今日日程', Icon: IconCalendar },
  { id: 'week', label: '周视图', Icon: IconWeek },
  { id: 'inbox', label: '收件箱', Icon: IconInbox },
  { id: 'insights', label: '洞察', Icon: IconChart }
]

export function Sidebar() {
  const t = useT()
  const view = useUIStore((s) => s.view)
  const setView = useUIStore((s) => s.setView)
  const tasks = useDataStore((s) => s.tasks)
  const search = useUIStore((s) => s.search)
  const setSearch = useUIStore((s) => s.setSearch)
  const searchOpen = useUIStore((s) => s.searchOpen)
  const toggleSearch = useUIStore((s) => s.toggleSearch)
  const openTaskModal = useUIStore((s) => s.openTaskModal)

  // 收起状态持久化在 settings 里，重启后保持一致
  const collapsed = useDataStore((s) => s.settings.sidebarCollapsed)
  const toggleCollapsed = async () => {
    const r = await window.api.settings.patch({ sidebarCollapsed: !collapsed })
    if (r.ok) useDataStore.getState().setSettings(r.data.settings)
  }

  /*
   * 收件箱角标口径必须和 InboxView 的列表一致：
   * 「完全没排期」+ 「已排时段但还没点确认」。
   * 早先只数 date === null，新建任务带了时段之后角标永远是 0 ——
   * 用户会以为任务没建上。
   */
  const inboxCount = useMemo(
    () => tasks.filter((t) => (t.date === null || t.pending === true) && t.status !== 'archived').length,
    [tasks]
  )

  const today = todayKey()
  const todayTasks = useMemo(
    () => tasks.filter((t) => t.date === today && t.status !== 'archived').length,
    [tasks, today]
  )

  return (
    <aside
      className={styles.root}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-drag="1"
    >
      {/*
       * 收起 / 展开按钮。
       * ⭐ 它**不能**放进 .brand —— 收起键的位置在两态必须完全一致
       *    （红绿灯右侧固定坐标），所以用绝对定位挂在侧栏根上，
       *    与品牌行的排版彻底解耦。
       */}
      <button
        className={styles.collapseBtn}
        onClick={() => void toggleCollapsed()}
        title={t(collapsed ? '展开左栏' : '收起左栏')}
        aria-label={t(collapsed ? '展开左栏' : '收起左栏')}
        aria-expanded={collapsed ? 'false' : 'true'}
      >
        <IconPanelLeft size={16} />
      </button>

      {/* 品牌区 */}
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className={styles.brandName}>FocusOS</span>
      </div>

      {/* 操作区 */}
      <div className={styles.actions}>
        <button
          className={styles.newBtn}
          onClick={() => openTaskModal()}
          title={t('新建任务 N')}
        >
          <IconPlus size={15} />
          <span>{t('新建任务')}</span>
        </button>
        <button
          className={styles.iconBtn}
          onClick={() => {
            // 收起态下点搜索先展开侧栏，否则输入框没有可放的位置
            if (collapsed) void toggleCollapsed()
            toggleSearch()
          }}
          title={t('搜索 /')}
          aria-pressed={searchOpen}
        >
          <IconSearch size={15} />
        </button>
      </div>

      {searchOpen && !collapsed && (
        <div className={styles.searchBox}>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('搜索标题 / 标签 / 备注')}
            aria-label={t('搜索任务')}
          />
        </div>
      )}

      {/* 导航 */}
      <nav className={styles.nav}>
        {NAV.map(({ id, label, Icon }) => {
          const badge =
            id === 'inbox' ? inboxCount : id === 'day' ? todayTasks : 0
          return (
            <button
              key={id}
              className={styles.navItem}
              data-active={view === id ? 'true' : 'false'}
              onClick={() => setView(id)}
              title={t(label)}
            >
              <Icon size={16} />
              <span className={styles.navLabel}>{t(label)}</span>
              {badge > 0 && <span className={styles.navBadge}>{badge > 99 ? '99+' : badge}</span>}
            </button>
          )
        })}
      </nav>

      <div className={styles.spacer} />

      {/*
       * 底部字标「xyc design.」。
       * ⭐ 这是**品牌签名，不是界面文案**，因此不进 i18n 词典、也不随语言切换。
       *    纯文本节点：它落在 .root 的拖拽区里，不需要单独设 app-region。
       */}
      {/*
       * ⭐ 字标「xyc design.」本身就是设置入口 —— 不是文字下方另起一行按钮。
       *     · 设置图标在最左侧，与上方导航项的图标**同一条竖线**；
       *     · 「xyc」粗黑体，「design」衬线斜体 + 珊瑚红，句点随 xyc 色；
       *     · 点击整个字标进入设置页，hover / 选中态与导航项一致。
       *    收起态由 CSS 隐掉 .sigText，只剩那颗设置图标。
       */}
      <button
        className={styles.signature}
        data-active={view === 'settings' ? 'true' : 'false'}
        onClick={() => setView('settings')}
        title={t('设置')}
        aria-label={t('设置')}
      >
        <IconSettings size={16} />
        {/* 字标部分：品牌签名，不进 i18n、不随语言切换 */}
        <span className={styles.sigText}>
          <span className={styles.sigSans}>xyc</span>
          <span className={styles.sigSerif}>
            design
            <span className={styles.sigDot}>.</span>
          </span>
        </span>
      </button>
    </aside>
  )
}
