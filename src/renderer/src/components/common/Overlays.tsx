// ============================================================
//  Overlays.tsx — Onboarding / 快捷键速查 / Toast
// ============================================================
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { prettyAccelerator } from '@shared/platform'
import { orderBackgrounds, moveBackground } from '@shared/backgrounds'
import { useUIStore } from '../../stores/useUIStore'
import { useDataStore } from '../../stores/useDataStore'
import { useThemeStore } from '../../stores/useThemeStore'
import { useT } from '../../i18n'
import {
  IconSun, IconMoon, IconAuto, IconCheck, IconClose,
  IconPencil, IconCopy, IconArchive, IconTrash, IconRepeat
} from './Icons'
import type { ThemeMode } from '@shared/types'
import styles from './Overlays.module.css'

// ============================================================
//  Onboarding：3 步引导（选主题 → 设每日目标 → 绑定第一个任务）
// ============================================================
export function Onboarding() {
  const open = useUIStore((s) => s.onboardingOpen)
  const close = useUIStore((s) => s.setOnboarding)
  const toast = useUIStore((s) => s.toast)
  const settings = useDataStore((s) => s.settings)
  const setSettings = useDataStore((s) => s.setSettings)
  const reload = useDataStore((s) => s.reload)
  const setMode = useThemeStore((s) => s.setMode)

  const [step, setStep] = useState(0)
  const [limit, setLimit] = useState(settings.dailyPomodoroLimit)
  const [taskTitle, setTaskTitle] = useState('')
  const t = useT()

  if (!open) return null

  const finish = async () => {
    const r = await window.api.settings.patch({ onboardingDone: true, dailyPomodoroLimit: limit })
    if (r.ok) setSettings(r.data.settings)
    if (taskTitle.trim()) {
      const c = await window.api.task.create({ title: taskTitle.trim(), date: null })
      if (c.ok) await reload()
    }
    close(false)
    toast(t('设置完成，开始专注吧'), 'success')
  }

  return (
    <div className={styles.mask}>
      <div className={styles.modal}>
        <div className={styles.steps}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={styles.stepDot} data-on={i <= step ? 'true' : 'false'} />
          ))}
        </div>

        {step === 0 && (
          <div className={styles.stepBody}>
            <h2 className={styles.title}>{t('选择主题')}</h2>
            <p className={styles.desc}>{t('深色是深夜的壁灯，浅色是清晨的窗。稍后可随时更改。')}</p>
            <div className={styles.themePick}>
              {(
                [
                  { id: 'light', label: '浅色', Icon: IconSun },
                  { id: 'dark', label: '深色', Icon: IconMoon },
                  { id: 'system', label: '跟随系统', Icon: IconAuto }
                ] as { id: ThemeMode; label: string; Icon: typeof IconSun }[]
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={styles.themeBtn}
                  data-active={settings.theme === id ? 'true' : 'false'}
                  onClick={async () => {
                    const r = await window.api.settings.patch({ theme: id })
                    if (r.ok) {
                      setSettings(r.data.settings)
                      await setMode(id)
                    }
                  }}
                >
                  <Icon size={18} />
                  <span>{t(label)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className={styles.stepBody}>
            <h2 className={styles.title}>{t('设定每日目标')}</h2>
            <p className={styles.desc}>{t('建议从 6~8 个开始，先建立节奏再加量。')}</p>
            <div className={styles.limitPick}>
              {[4, 6, 8, 12].map((n) => (
                <button
                  key={n}
                  className={styles.limitBtn}
                  data-active={limit === n ? 'true' : 'false'}
                  onClick={() => setLimit(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className={styles.descCenter}>{t('个番茄 / 天')}</p>
          </div>
        )}

        {step === 2 && (
          <div className={styles.stepBody}>
            <h2 className={styles.title}>{t('绑定第一个任务')}</h2>
            <p className={styles.desc}>{t('先记一件今天一定要做的事，计时时可以带着它。')}</p>
            <input
              className={styles.taskInput}
              autoFocus
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void finish()
              }}
              placeholder={t('例如：写完项目周报')}
            />
          </div>
        )}

        <div className={styles.ops}>
          {/*
           * ⭐ 「跳过」也要落盘 onboardingDone。
           *    早先只 close(false)（仅关掉本窗口的浮层）→ 设置里 onboardingDone
           *    一直是 false，下次启动引导层又弹出来，把「收起/展开左栏」按钮等
           *    窗口控件压在遮罩下面（用户实测反馈「点了没反应」）。
           *    跳过 = 不再打扰，必须持久化。
           */}
          <button
            className={styles.skip}
            onClick={() => {
              void window.api.settings.patch({ onboardingDone: true })
              close(false)
            }}
          >
            {t('跳过')}
          </button>
          <div className={styles.opsRight}>
            {step > 0 && (
              <button className={styles.btnGhost} onClick={() => setStep(step - 1)}>
                {t('上一步')}
              </button>
            )}
            {step < 2 ? (
              <button className={styles.btnPrimary} onClick={() => setStep(step + 1)}>
                {t('下一步')}
              </button>
            ) : (
              <button className={styles.btnPrimary} onClick={() => void finish()}>
                <IconCheck size={14} />
                <span>{t('完成')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
//  快捷键速查面板：CmdOrCtrl+/ 唤出
// ============================================================
const IN_APP: [string, string][] = [
  ['空格', '开始 / 暂停'],
  ['R', '重置'],
  ['B', '立即休息'],
  ['S', '跳过阶段'],
  ['F', '全屏 / 小窗'],
  ['Esc', '返回上一层'],
  ['N', '新建任务'],
  ['/', '搜索'],
  ['T', '切换主题']
]

const GLOBAL: string[] = [
  'CmdOrCtrl+Shift+Space',
  'CmdOrCtrl+Shift+F',
  'CmdOrCtrl+Shift+N',
  'CmdOrCtrl+Shift+D'
]

export function ShortcutPanel() {
  const open = useUIStore((s) => s.shortcutPanelOpen)
  const close = useUIStore((s) => s.setShortcutPanel)
  const t = useT()

  if (!open) return null

  return (
    <div className={styles.mask} onClick={() => close(false)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.panelHead}>
          <h2 className={styles.title}>{t('快捷键')}</h2>
          <button className={styles.closeBtn} onClick={() => close(false)} aria-label={t('关闭')}>
            <IconClose size={15} />
          </button>
        </div>

        <h3 className={styles.groupTitle}>{t('全局')}</h3>
        <div className={styles.list}>
          {GLOBAL.map((acc) => (
            <div key={acc} className={styles.item}>
              <span className={styles.itemLabel}>{t('全局快捷键')}</span>
              {/* ⭐ 按键符号经 prettyAccelerator 渲染 */}
              <kbd className={styles.kbd}>{prettyAccelerator(acc)}</kbd>
            </div>
          ))}
        </div>

        <h3 className={styles.groupTitle}>{t('窗口内')}</h3>
        <div className={styles.list}>
          {IN_APP.map(([key, label]) => (
            <div key={key} className={styles.item}>
              <span className={styles.itemLabel}>{t(label)}</span>
              <kbd className={styles.kbd}>{key}</kbd>
            </div>
          ))}
        </div>

        <p className={styles.foot}>{t('输入框聚焦时窗口内快捷键自动失效（Esc 除外）')}</p>
      </div>
    </div>
  )
}

// ============================================================
//  右键菜单的公共外壳
// ============================================================
//  ⚠️ 位置取点击瞬间的 clientX/clientY，并做视口夹取 ——
//     否则在窗口右/下边缘右键时菜单会跑到屏幕外。
//  两个菜单（任务卡 / 日程事件）共用这一层，避免夹取逻辑各写一遍后跑偏。
function MenuShell({
  x,
  y,
  testId,
  children
}: {
  x: number
  y: number
  testId: string
  children: React.ReactNode
}) {
  const closeMenus = useUIStore((s) => s.closeMenus)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // 先按点击点渲染，量到真实尺寸后再夹取回视口内
  useLayoutEffect(() => {
    if (!ref.current) return
    const box = ref.current.getBoundingClientRect()
    const pad = 8
    setPos({
      x: Math.max(pad, Math.min(x, window.innerWidth - box.width - pad)),
      y: Math.max(pad, Math.min(y, window.innerHeight - box.height - pad))
    })
  }, [x, y])

  // 点空白 / Esc / 滚动 都收起
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenus()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', closeMenus, true)
    window.addEventListener('resize', closeMenus)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', closeMenus, true)
      window.removeEventListener('resize', closeMenus)
    }
  }, [closeMenus])

  return (
    <div
      ref={ref}
      className={styles.contextMenu}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      data-testid={testId}
    >
      {children}
    </div>
  )
}

// ============================================================
//  任务卡右键菜单
// ============================================================
export function TaskContextMenu() {
  const menu = useUIStore((s) => s.taskMenu)
  const closeMenu = useUIStore((s) => s.closeTaskMenu)
  const openTaskModal = useUIStore((s) => s.openTaskModal)
  const askConfirm = useUIStore((s) => s.askConfirm)
  const toast = useUIStore((s) => s.toast)
  const toastWithAction = useUIStore((s) => s.toastWithAction)
  const tasks = useDataStore((s) => s.tasks)
  const reload = useDataStore((s) => s.reload)
  const t = useT()

  if (!menu) return null
  const task = tasks.find((x) => x.id === menu.taskId)
  if (!task) return null

  const done = async (r: { ok: boolean; error?: string }, msg: string) => {
    closeMenu()
    if (!r.ok) {
      toast(r.error ?? t('操作失败'), 'error')
      return
    }
    await reload()
    if (msg) toast(msg, 'success')
  }

  return (
    <MenuShell x={menu.x} y={menu.y} testId="task-context-menu">
      <div className={styles.contextTitle} title={task.title}>
        {task.title}
      </div>

      <button
        className={styles.contextItem}
        role="menuitem"
        onClick={() => {
          closeMenu()
          openTaskModal(task.id)
        }}
      >
        <IconPencil size={14} />
        <span>{t('编辑')}</span>
      </button>

      <button
        className={styles.contextItem}
        role="menuitem"
        onClick={() => void window.api.task.duplicate(task.id).then((r) => done(r, t('已创建副本')))}
      >
        <IconCopy size={14} />
        <span>{t('复制副本')}</span>
      </button>

      <button
        className={styles.contextItem}
        role="menuitem"
        onClick={() => void window.api.task.archive(task.id).then((r) => done(r, t('已归档')))}
      >
        <IconArchive size={14} />
        <span>{t('归档')}</span>
      </button>

      <div className={styles.contextSep} />

      {/* ⭐ 删除必须二次确认 */}
      <button
        className={styles.contextItem}
        role="menuitem"
        data-danger="true"
        onClick={() =>
          askConfirm({
            title: t('删除任务'),
            message: t('确定删除「{title}」吗？此操作不可撤销。', { title: task.title }),
            confirmLabel: t('删除'),
            danger: true,
            onConfirm: async () => {
              const r = await window.api.task.remove(task.id)
              if (!r.ok) {
                toast(r.error ?? t('删除失败'), 'error')
                return
              }
              const snapshot = r.data
              await reload()
              // 与日程右键删除保持一致：删完给一次反悔机会
              toastWithAction(
                t('已删除「{title}」', { title: task.title }),
                {
                  label: t('撤销'),
                  onClick: async () => {
                    const back = await window.api.task.restore(snapshot)
                    if (!back.ok) {
                      toast(back.error ?? t('撤销失败'), 'error')
                      return
                    }
                    await reload()
                    toast(t('已撤销'), 'success')
                  }
                },
                'success'
              )
            }
          })
        }
      >
        <IconTrash size={14} />
        <span>{t('删除…')}</span>
      </button>
    </MenuShell>
  )
}

// ============================================================
//  日程事件（时间轴上的块）右键菜单
// ============================================================
//  用户明确要求：日程里创建的事件右键可以删除，且**必须有二次确认**。
//  两种块语义不同：
//    · 任务块（kind='task'）→ 删除整个任务
//    · 计划块（kind='plan'）→ 只删这一个番茄计划块，源任务保留
export function ScheduleContextMenu() {
  const menu = useUIStore((s) => s.blockMenu)
  const closeMenu = useUIStore((s) => s.closeBlockMenu)
  const openTaskModal = useUIStore((s) => s.openTaskModal)
  const askConfirm = useUIStore((s) => s.askConfirm)
  const toast = useUIStore((s) => s.toast)
  const toastWithAction = useUIStore((s) => s.toastWithAction)
  const reload = useDataStore((s) => s.reload)
  const t = useT()

  if (!menu) return null

  const isPlan = menu.kind === 'plan'
  /** 重复任务的实例：可以只删这一次，而不动整条系列 */
  const isRepeatInstance = !isPlan && !!menu.repeat && menu.repeat !== 'none' && !!menu.date

  return (
    <MenuShell x={menu.x} y={menu.y} testId="schedule-context-menu">
      <div className={styles.contextTitle} title={menu.title}>
        {menu.title}
      </div>

      <button
        className={styles.contextItem}
        role="menuitem"
        onClick={() => {
          closeMenu()
          // 计划块回指源任务；任务块就是自己
          openTaskModal(menu.taskId ?? menu.blockId)
        }}
      >
        <IconPencil size={14} />
        <span>{t('编辑')}</span>
      </button>

      {/*
        ⭐ 重复任务的实例必须有这个入口。
        没有它时，「删掉这周四那一次」只能连整条系列一起删掉 ——
        用户想放的假、想改的期，代价太大。
      */}
      {isRepeatInstance && (
        <button
          className={styles.contextItem}
          role="menuitem"
          onClick={() =>
            askConfirm({
              title: t('只删除这一次'),
              message: t('只跳过「{title}」在这一天的这一次？重复规则本身会保留。', {
                title: menu.title
              }),
              confirmLabel: t('只删这一次'),
              onConfirm: async () => {
                const r = await window.api.task.skipInstance(menu.blockId, menu.date as string)
                if (!r.ok) {
                  toast(r.error ?? t('删除失败'), 'error')
                  return
                }
                await reload()
                toast(t('已跳过这一次'), 'success')
              }
            })
          }
        >
          <IconRepeat size={14} />
          <span>{t('只删除这一次')}</span>
        </button>
      )}

      <div className={styles.contextSep} />

      {/* ⭐ 删除：必须过二次确认弹窗 */}
      <button
        className={styles.contextItem}
        role="menuitem"
        data-danger="true"
        onClick={() =>
          askConfirm({
            title: t(isPlan ? '删除计划块' : '删除日程事件'),
            message: isPlan
              ? t('确定删除「{title}」的这一块吗？只删这一块，原任务不受影响。', { title: menu.title })
              : isRepeatInstance
                ? t('确定删除「{title}」的**整条**重复系列吗？此操作不可撤销。', { title: menu.title })
                : t('确定删除「{title}」吗？会连同这个任务一起删除，此操作不可撤销。', { title: menu.title }),
            confirmLabel: t('删除'),
            danger: true,
            onConfirm: async () => {
              if (isPlan) {
                const r = await window.api.plan.remove(menu.blockId)
                if (!r.ok) {
                  toast(r.error ?? t('删除失败'), 'error')
                  return
                }
                await reload()
                toast(t('已删除'), 'success')
                return
              }

              const r = await window.api.task.remove(menu.blockId)
              if (!r.ok) {
                toast(r.error ?? t('删除失败'), 'error')
                return
              }
              const snapshot = r.data
              await reload()
              /*
               * ⭐ 删除后给一次反悔机会。
               *    确认弹窗只能防「手滑点错菜单」，防不了「删完才想起来」；
               *    计划块也一起留在快照里，撤销后番茄计划不会丢。
               */
              toastWithAction(
                t('已删除「{title}」', { title: menu.title }),
                {
                  label: t('撤销'),
                  onClick: async () => {
                    const back = await window.api.task.restore(snapshot)
                    if (!back.ok) {
                      toast(back.error ?? t('撤销失败'), 'error')
                      return
                    }
                    await reload()
                    toast(t('已撤销'), 'success')
                  }
                },
                'success'
              )
            }
          })
        }
      >
        <IconTrash size={14} />
        <span>{t('删除…')}</span>
      </button>
    </MenuShell>
  )
}

// ============================================================
//  背景图缩略图右键菜单
// ============================================================
//  ⚠️ 原来缩略图右上角有个小垃圾桶角标，但缩略图是 draggable 的，
//     角标按下去会被浏览器的拖拽手势吃掉，click 永远不触发
//     （用户反馈「点击删除没反应」）。改成右键菜单后与拖拽互不干扰。
export function BackgroundContextMenu() {
  const menu = useUIStore((s) => s.bgMenu)
  const closeMenus = useUIStore((s) => s.closeMenus)
  const askConfirm = useUIStore((s) => s.askConfirm)
  const toast = useUIStore((s) => s.toast)
  const setBackgrounds = useDataStore((s) => s.setBackgrounds)
  const backgrounds = useDataStore((s) => s.backgrounds)
  const settings = useDataStore((s) => s.settings)
  const setSettings = useDataStore((s) => s.setSettings)
  const t = useT()

  if (!menu) return null

  /*
   * 「默认」= 列表里的第一张 —— 关闭轮播时显示的就是它（见 shared/backgrounds.ts
   * 里 activeBackground 的语义）。所以「设为默认」不是新加一个字段，而是把这张
   * 挪到队首，和拖拽排序写的是同一个 settings.background.order。
   *
   * ⚠️ 用 url 在 ordered 里查下标，不信 menu.index：
   *    菜单开着的时候用户可能已经拖过一次顺序，menu.index 会是旧位置。
   */
  const ordered = orderBackgrounds(backgrounds, settings.background.order)
  const currentIndex = ordered.indexOf(menu.url)
  const isDefault = currentIndex <= 0

  const setDefault = async (): Promise<void> => {
    if (isDefault) return
    const next = moveBackground(ordered, currentIndex, 0)
    const r = await window.api.settings.patch({
      background: { ...settings.background, order: next }
    })
    if (!r.ok) {
      toast(r.error, 'error')
      return
    }
    setSettings(r.data.settings)
    closeMenus()
    // 轮播开着时，队首那张要等轮播关掉才真正生效 —— 别让用户以为按了没反应
    toast(
      settings.background.rotate
        ? t('已设为默认背景，关闭轮播后生效')
        : t('已设为默认背景'),
      'success'
    )
  }

  /**
   * ⭐「删除」= 只在应用里删，磁盘上的图片文件一个字节都不动。
   *    主进程会顺手把它从轮播顺序里摘掉，所以这里不用再单独 patch 一次 order。
   *    界面文案必须说实话：确认框里写清「文件不会丢失」，
   *    否则用户会以为自己在删电脑上的原图。
   */
  const remove = async (): Promise<void> => {
    const r = await window.api.sys.removeBackground(menu.url)
    /*
     * ⚠️ 必须判 r.data 的具体值，不能只判 r.ok：
     *    业务层失败时是 { ok:true, data:'failed' }（IPC 层没出错）。
     *    旧代码只判 r.ok，于是失败也被当成成功 —— 弹「已删除」但图还在。
     */
    if (!r.ok || r.data !== 'removed') {
      toast(!r.ok ? r.error : t('删除失败'), 'error')
      return
    }
    const b = await window.api.sys.backgrounds()
    if (b.ok) setBackgrounds(b.data)
    toast(t('已删除'), 'success')
  }

  return (
    <MenuShell x={menu.x} y={menu.y} testId="bg-context-menu">
      <div className={styles.contextTitle}>{t('第 {n} 张背景图', { n: menu.index + 1 })}</div>

      {/* 设为默认：置灰而不是隐藏 —— 让人看到「它已经是默认了」这个事实 */}
      <button
        className={styles.contextItem}
        role="menuitem"
        disabled={isDefault}
        onClick={() => void setDefault()}
        data-testid="bg-set-default"
      >
        <IconCheck size={14} />
        <span>{isDefault ? t('当前默认') : t('设为默认')}</span>
      </button>

      <div className={styles.contextSep} />

      <button
        className={styles.contextItem}
        role="menuitem"
        data-danger="true"
        onClick={() =>
          askConfirm({
            title: t('删除背景图'),
            message: t('确定删除这张背景图吗？只会从应用的列表里移除，电脑上的图片文件不会丢失。'),
            confirmLabel: t('删除'),
            danger: true,
            onConfirm: remove
          })
        }
      >
        <IconTrash size={14} />
        <span>{t('删除…')}</span>
      </button>
    </MenuShell>
  )
}

// ============================================================
//  二次确认对话框
// ============================================================
export function ConfirmDialog() {
  const req = useUIStore((s) => s.confirmDialog)
  const close = useUIStore((s) => s.closeConfirm)
  const [busy, setBusy] = useState(false)
  const t = useT()

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req, close])

  if (!req) return null

  const confirm = async () => {
    setBusy(true)
    try {
      await req.onConfirm()
    } finally {
      setBusy(false)
      close()
    }
  }

  return (
    <div className={styles.mask} onClick={close} data-testid="confirm-dialog">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="alertdialog">
        <h2 className={styles.title}>{req.title}</h2>
        <p className={styles.desc}>{req.message}</p>
        <div className={`${styles.ops} ${styles.opsCenter}`}>
          <div className={styles.opsRight}>
            <button className={styles.btnGhost} onClick={close} disabled={busy}>
              {t('取消')}
            </button>
            <button
              className={req.danger ? styles.btnDanger : styles.btnPrimary}
              onClick={() => void confirm()}
              disabled={busy}
            >
              {req.confirmLabel ?? t('删除')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
//  空闲回处理对话框
// ============================================================
//  ⭐ 主进程只负责「测出离开了多久」，要不要问、问了怎么补偿在这里决定。
//     默认按钮是「保留计时」而不是「不计入」：
//     丢掉时间是不可逆的，必须由用户主动选，不能替他做主。
export function IdleDialog() {
  const req = useUIStore((s) => s.idleDialog)
  const close = useUIStore((s) => s.closeIdleDialog)
  const toast = useUIStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const t = useT()

  if (!req) return null

  const minutes = Math.max(1, Math.round(req.seconds / 60))

  const discard = async () => {
    setBusy(true)
    try {
      // 计时状态由引擎自己推送（timer:tick），这里不需要手动刷新数据
      const r = await window.api.timer.discardIdle(req.seconds)
      if (!r.ok) {
        toast(r.error ?? t('操作失败'), 'error')
        return
      }
      toast(t('已把这段时间从统计里去掉'), 'success')
      close()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.mask} onClick={close} data-testid="idle-dialog">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="alertdialog">
        <h2 className={styles.title}>{t('你离开了 {n} 分钟', { n: minutes })}</h2>
        <p className={styles.desc}>{t('这期间计时仍在走。要把这段时间从统计里去掉吗？')}</p>
        <div className={`${styles.ops} ${styles.opsCenter}`}>
          <div className={styles.opsRight}>
            <button className={styles.btnGhost} onClick={close} disabled={busy}>
              {t('保留计时')}
            </button>
            <button className={styles.btnPrimary} onClick={() => void discard()} disabled={busy}>
              {t('不计入')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
//  Toast
// ============================================================
export function Toasts() {
  const toasts = useUIStore((s) => s.toasts)
  const dismiss = useUIStore((s) => s.dismissToast)

  return (
    <div className={styles.toastWrap}>
      {/* 变量名避开 t —— 它是全应用统一的翻译函数名，别覆盖掉 */}
      {toasts.map((toast) => (
        <div key={toast.id} className={styles.toast} data-kind={toast.kind}>
          {/* 点文字仍然可以立刻收起；操作按钮则要单独接住点击 */}
          <span className={styles.toastText} onClick={() => dismiss(toast.id)}>
            {toast.text}
          </span>
          {toast.action && (
            <button
              className={styles.toastAction}
              onClick={(e) => {
                e.stopPropagation()
                // 先收起再执行：撤销这类操作可能弹出新的提示，避免叠两层
                dismiss(toast.id)
                void toast.action?.onClick()
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
