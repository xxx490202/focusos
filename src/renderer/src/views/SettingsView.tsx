// ============================================================
//  SettingsView.tsx — 设置页
// ============================================================
//  ⭐ 设置项按平台条件显示：backgroundMaterial 相关仅 Win11 可见，
//     titleBarOverlay 相关仅 Windows 可见。
//     绝不向用户暴露当前平台不支持的选项。
//  ⭐ 快捷键展示必须经 keyLabel() 渲染。
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import {
  IconSun, IconMoon, IconAuto, IconImage, IconBell, IconFolder,
  IconDownload, IconUpload, IconTrash, IconLock, IconCheck
} from '../components/common/Icons'
import { orderBackgrounds, moveBackground, rainSizeScale } from '@shared/backgrounds'
import { LANGS } from '@shared/i18n'
import { useT } from '../i18n'
import { useDataStore } from '../stores/useDataStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useUIStore } from '../stores/useUIStore'
import { prettyAccelerator } from '@shared/platform'
import { mediaUrl } from '@shared/media'
import type { Settings, ThemeMode } from '@shared/types'
import type { SystemInfo } from '../types/global'
import styles from './SettingsView.module.css'

type Group = 'theme' | 'timer' | 'schedule' | 'notify' | 'data' | 'about'

const GROUPS: { id: Group; label: string }[] = [
  { id: 'theme', label: '主题' },
  { id: 'timer', label: '计时' },
  { id: 'schedule', label: '日程' },
  { id: 'notify', label: '提醒' },
  { id: 'data', label: '数据' },
  { id: 'about', label: '关于' }
]

export function SettingsView() {
  const t = useT()
  const settings = useDataStore((s) => s.settings)
  const setSettings = useDataStore((s) => s.setSettings)
  const backgrounds = useDataStore((s) => s.backgrounds)
  const setBackgrounds = useDataStore((s) => s.setBackgrounds)
  const platformInfo = useDataStore((s) => s.platformInfo)
  const legacyMigrated = useDataStore((s) => s.legacyMigrated)

  const setMode = useThemeStore((s) => s.setMode)
  const toast = useUIStore((s) => s.toast)
  const askConfirm = useUIStore((s) => s.askConfirm)
  const openBgMenu = useUIStore((s) => s.openBgMenu)

  const [group, setGroup] = useState<Group>('theme')
  const [sys, setSys] = useState<SystemInfo | null>(null)

  useEffect(() => {
    void window.api.window.state().then((r) => {
      if (r.ok) setSys(r.data)
    })
  }, [])

  // 所有设置即时生效并立即落盘
  const patch = async (p: Partial<Settings>) => {
    const r = await window.api.settings.patch(p)
    if (!r.ok) {
      toast(r.error, 'error')
      return
    }
    setSettings(r.data.settings)
    if (p.theme !== undefined) await setMode(p.theme)
  }

  const patchBg = async (bg: Partial<Settings['background']>) => {
    await patch({ background: { ...settings.background, ...bg } })
  }

  // ---- 背景图排序 ----
  // 合并「扫描顺序」与「用户排序」：新导入的图会自动追加在末尾
  const ordered = useMemo(
    () => orderBackgrounds(backgrounds, settings.background.order),
    [backgrounds, settings.background.order]
  )
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  /** 写入排好的顺序；因为已列出全部图片，下次 orderBackgrounds 会原样返回 */
  const commitOrder = (next: string[]) => patchBg({ order: next })

  /**
   * 把缩略图按来源分成两组：内置壁纸 / 我自己添加的。
   *
   * ⭐ 依据只能是路径前缀：内置壁纸在打包产物的 resources/backgrounds 下，
   *    用户导入的会被复制进 userData/backgrounds（system:info 里的 backgroundsDir）。
   *
   * ⚠️ 元素上带的是**全局下标 i**（ordered 里的位置），不是组内下标：
   *    拖拽排序写的是全局 order 数组，用组内下标会算错位置。
   *    跨组拖拽因此也是合法的 —— 它改的就是全局顺序。
   */
  const bgGroups = useMemo(() => {
    const userDir = sys?.backgroundsDir ?? ''
    const isUser = (u: string): boolean => {
      if (!userDir) return false
      try {
        return decodeURIComponent(u.replace(/^file:\/\//, '')).startsWith(userDir)
      } catch {
        return false
      }
    }
    const builtin: { url: string; i: number }[] = []
    const mine: { url: string; i: number }[] = []
    ordered.forEach((u, i) => (isUser(u) ? mine : builtin).push({ url: u, i }))
    return { builtin, mine }
  }, [ordered, sys])

  /** 一张缩略图。两个分组共用，所以抽成闭包而不是内联一大段 JSX */
  const renderThumb = ({ url, i }: { url: string; i: number }) => (
    <div
      key={url}
      className={styles.thumb}
      draggable
      data-first={i === 0 ? 'true' : 'false'}
      /* 仅在关闭轮播时给第一张蓝色描边 —— 那时它才是真正生效的背景 */
      data-active={i === 0 && !settings.background.rotate ? 'true' : 'false'}
      data-dragging={dragIdx === i ? 'true' : 'false'}
      data-over={dragIdx !== null && overIdx === i && dragIdx !== i ? 'true' : 'false'}
      title={
        i === 0
          ? t('第一张 · 关闭轮播时显示这张（可拖拽调整顺序）')
          : t('第 {n} 张 · 可拖拽调整顺序', { n: i + 1 })
      }
      onDragStart={(e) => {
        setDragIdx(i)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOverIdx(i)
      }}
      onDragLeave={() => setOverIdx((v) => (v === i ? null : v))}
      onDrop={(e) => {
        e.preventDefault()
        if (dragIdx !== null && dragIdx !== i) {
          void commitOrder(moveBackground(ordered, dragIdx, i))
        }
        setDragIdx(null)
        setOverIdx(null)
      }}
      onDragEnd={() => {
        setDragIdx(null)
        setOverIdx(null)
      }}
      /*
       * ⭐ 删除改成右键 → 指针位置弹菜单（与今日日程一致）。
       *    原先右上角那个小角标压在 draggable 容器里，
       *    按下会被浏览器拖拽手势吞掉，click 根本不触发
       *    （用户反馈「点击删除没反应」）。
       */
      onContextMenu={(e) => {
        e.preventDefault()
        openBgMenu({ url, index: i, x: e.clientX, y: e.clientY })
      }}
    >
      <img src={mediaUrl(url)} alt="" draggable={false} />
      {i === 0 && <span className={styles.thumbFirst}>{t('默认')}</span>}
    </div>
  )

  return (
    <div className={styles.root}>
      {/* 顶栏：与其它页面一致，同时是窗口拖拽区 */}
      <header className={styles.bar} data-drag="1">
        <h2 className={styles.title}>{t('设置')}</h2>
        <span className={styles.barHint}>{t(GROUPS.find((g) => g.id === group)?.label ?? '')}</span>
      </header>

      <div className={styles.body}>
        <nav className={styles.nav}>
          {GROUPS.map((g) => (
            <button
              key={g.id}
              className={styles.navItem}
              data-active={group === g.id ? 'true' : 'false'}
              onClick={() => setGroup(g.id)}
            >
              {t(g.label)}
            </button>
          ))}
        </nav>

        <div className={styles.panel}>
          {/* ================= 主题 ================= */}
          {group === 'theme' && (
            <>
              {/*
                ⭐ 语言必须排在「外观」之上（用户明确要求「在设置页主题上方加一个
                   设置项，语言」）。选项用各自语言的原生写法，不懂中文的用户
                   也能找到切回去的入口。
              */}
              <Section title={t('语言')}>
                <div className={styles.segRow}>
                  <div className={styles.segGroup}>
                    {LANGS.map((l) => (
                      <button
                        key={l.id}
                        className={styles.segBtn}
                        data-active={settings.language === l.id ? 'true' : 'false'}
                        onClick={() => void patch({ language: l.id })}
                        title={l.hint}
                      >
                        <span>{l.native}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              <Section title={t('外观')}>
              <div className={styles.segRow}>
                <div className={styles.segGroup}>
                  {(
                    [
                      { id: 'light', label: '浅色', Icon: IconSun },
                      { id: 'dark', label: '深色', Icon: IconMoon },
                      { id: 'system', label: '跟随系统', Icon: IconAuto }
                    ] as { id: ThemeMode; label: string; Icon: typeof IconSun }[]
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      className={styles.segBtn}
                      data-active={settings.theme === id ? 'true' : 'false'}
                      onClick={() => void patch({ theme: id })}
                    >
                      <Icon size={14} />
                      <span>{t(label)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            <Section title={t('日落自动切换')}>
              <Row label={t('启用')}>
                <Toggle
                  checked={settings.autoSwitch}
                  onChange={(v) => void patch({ autoSwitch: v })}
                />
              </Row>
              {settings.autoSwitch && (
                <>
                  <Row label={t('进入夜间')}>
                    <input
                      className={styles.timeInput}
                      type="time"
                      value={settings.autoDarkFrom}
                      onChange={(e) => void patch({ autoDarkFrom: e.target.value })}
                    />
                  </Row>
                  <Row label={t('回到白天')}>
                    <input
                      className={styles.timeInput}
                      type="time"
                      value={settings.autoLightFrom}
                      onChange={(e) => void patch({ autoLightFrom: e.target.value })}
                    />
                  </Row>
                </>
              )}
            </Section>

            <Section title={t('背景模式')}>
              <Row label={t('启用背景')}>
                <Toggle
                  checked={settings.background.enabled}
                  onChange={(v) => void patchBg({ enabled: v })}
                />
              </Row>
              <Row label={t('启用轮播')}>
                <Toggle
                  checked={settings.background.rotate}
                  onChange={(v) => void patchBg({ rotate: v })}
                />
              </Row>
              {/*
               * ⭐ 雨点开关紧跟在「启用轮播」下面（用户指定的位置）。
               *    背景关掉时禁用而不是隐藏：藏起来用户会以为功能没了，
               *    禁用态至少还能看出「它属于背景模式」——
               *    与上面「轮播间隔随轮播开关禁用」保持同一套规则。
               */}
              <Row label={t('雨点效果')}>
                <Toggle
                  checked={settings.background.rain}
                  disabled={!settings.background.enabled}
                  onChange={(v) => void patchBg({ rain: v })}
                />
              </Row>
              {/*
               * ⭐ 雨点大小紧跟在雨点开关下一行（用户要求的位置）。
               *    关掉雨点后这一行没意义 → 与相邻规则一致：禁用而不是隐藏。
               */}
              <Row label={t('雨点大小')}>
                <input
                  className={styles.range}
                  type="range"
                  min={0}
                  max={100}
                  disabled={!settings.background.enabled || !settings.background.rain}
                  value={settings.background.rainSize}
                  onChange={(e) => void patchBg({ rainSize: Number(e.target.value) })}
                />
                <span className={styles.value}>
                  {rainSizeScale(settings.background.rainSize).toFixed(2)}×
                </span>
              </Row>
              {/* 关掉轮播后间隔就没意义了，直接禁用比藏起来更好懂 */}
              <Row label={t('轮播间隔')}>
                <input
                  className={styles.numberInput}
                  type="number"
                  min={5}
                  max={600}
                  disabled={!settings.background.rotate}
                  value={settings.background.rotateSeconds}
                  onChange={(e) => void patchBg({ rotateSeconds: Number(e.target.value) })}
                />
                <span className={styles.unit}>{t('秒')}</span>
              </Row>
              <Row label={t('文字遮罩')}>
                <input
                  className={styles.range}
                  type="range"
                  min={0}
                  max={100}
                  value={settings.background.overlay}
                  onChange={(e) => void patchBg({ overlay: Number(e.target.value) })}
                />
                <span className={styles.value}>{settings.background.overlay}%</span>
              </Row>
              <Row label={t('模糊')}>
                <input
                  className={styles.range}
                  type="range"
                  min={0}
                  max={40}
                  value={settings.background.blur}
                  onChange={(e) => void patchBg({ blur: Number(e.target.value) })}
                />
                <span className={styles.value}>{settings.background.blur}px</span>
              </Row>
              <Row label={t('暗角')}>
                <input
                  className={styles.range}
                  type="range"
                  min={0}
                  max={100}
                  value={settings.background.vignette}
                  onChange={(e) => void patchBg({ vignette: Number(e.target.value) })}
                />
                <span className={styles.value}>{settings.background.vignette}%</span>
              </Row>
              <Row label={t('按背景亮度自动反转文字色')}>
                <Toggle
                  checked={settings.background.autoTextColor}
                  onChange={(v) => void patchBg({ autoTextColor: v })}
                />
              </Row>

              <Row label={t('导入图片')}>
                <button
                  className={styles.btnGhost}
                  onClick={async () => {
                    const r = await window.api.sys.pickBackground()
                    if (!r.ok) {
                      toast(r.error, 'error')
                      return
                    }
                    /*
                     * ⭐ 一律以主进程的**扫描结果**为准刷列表。
                     *    之前只往本地数组里拼 r.data，一旦这条 IPC 的返回值
                     *    不是数组（Promise 被序列化成 `{}`），就会静默什么都不显示 ——
                     *    文件其实已经复制进去了，用户却以为导入失败。
                     *    走 sys.backgrounds() 拿真源，即使返回值有异常列表也照样刷出来。
                     */
                    const b = await window.api.sys.backgrounds()
                    setBackgrounds(b.ok ? b.data : [...backgrounds, ...r.data])
                    // 用户取消选择时返回空数组，不是错误，静默即可
                    if (r.data.length === 0) return
                    toast(t('已导入 {n} 张背景图', { n: r.data.length }), 'success')
                  }}
                >
                  <IconImage size={14} />
                  <span>{t('选择文件')}</span>
                </button>
              </Row>
              {/*
               * 缩略图分两行：内置壁纸在上、用户自己添加的在下。
               * 行标题用 flex-basis:100% 在 wrap 布局里独占一行 ——
               * 不额外套容器，也就不会和 .thumbs 的内边距叠成双份。
               * 第一张（全局第一张）即「关闭轮播时」显示的那张。
               */}
              {bgGroups.builtin.length > 0 && (
                <div className={styles.thumbs}>
                  <div className={styles.thumbsLabel}>{t('内置壁纸')}</div>
                  {bgGroups.builtin.map(renderThumb)}
                </div>
              )}
              {bgGroups.mine.length > 0 && (
                <div className={styles.thumbs}>
                  <div className={styles.thumbsLabel}>{t('我添加的')}</div>
                  {bgGroups.mine.map(renderThumb)}
                </div>
              )}
            </Section>
          </>
        )}

        {/* ================= 计时 ================= */}
        {group === 'timer' && (
          <>
            <Section title={t('各阶段时长')}>
              <Row label={t('专注')}>
                <NumInput
                  value={settings.durations.workMinutes}
                  min={1}
                  max={180}
                  onChange={(v) =>
                    void patch({
                      durations: { ...settings.durations, workMinutes: v }
                    })
                  }
                />
                <span className={styles.unit}>{t('分钟')}</span>
              </Row>
              <Row label={t('短休息')}>
                <NumInput
                  value={settings.durations.shortBreakMinutes}
                  min={1}
                  max={60}
                  onChange={(v) =>
                    void patch({
                      durations: { ...settings.durations, shortBreakMinutes: v }
                    })
                  }
                />
                <span className={styles.unit}>{t('分钟')}</span>
              </Row>
              <Row label={t('长休息')}>
                <NumInput
                  value={settings.durations.longBreakMinutes}
                  min={1}
                  max={180}
                  onChange={(v) =>
                    void patch({
                      durations: { ...settings.durations, longBreakMinutes: v }
                    })
                  }
                />
                <span className={styles.unit}>{t('分钟')}</span>
              </Row>
              <Row label={t('长休息周期')}>
                <NumInput
                  value={settings.longBreakEvery}
                  min={1}
                  max={12}
                  onChange={(v) => void patch({ longBreakEvery: v })}
                />
                <span className={styles.unit}>{t('个专注后')}</span>
              </Row>
            </Section>

            {/* ================= 专注模式 ================= */}
            <Section title={t('专注模式')}>
              <Row label={t('模式')}>
                <Choice
                  value={settings.focusMode}
                  onChange={(v) => void patch({ focusMode: v })}
                  options={[
                    { value: 'pomodoro', label: t('番茄钟') },
                    { value: 'flowtime', label: t('心流') }
                  ]}
                />
              </Row>
              <Row label={t('说明')}>
                <span className={styles.note}>
                  {settings.focusMode === 'pomodoro'
                    ? t('倒计时到点自动结束，按上面的阶段时长与长休息周期走。')
                    : t('正计时，想停才停；停下来时按下面的规则反算休息时长。')}
                </span>
              </Row>

              {settings.focusMode === 'flowtime' && (
                <>
                  <Row label={t('停止后自动进入休息')}>
                    <Toggle
                      checked={settings.flowtime.breakEnabled}
                      onChange={(v) =>
                        void patch({ flowtime: { ...settings.flowtime, breakEnabled: v } })
                      }
                    />
                  </Row>

                  {settings.flowtime.breakEnabled && (
                    <>
                      <Row label={t('休息时长算法')}>
                        <Choice
                          value={settings.flowtime.breakMode}
                          onChange={(v) =>
                            void patch({ flowtime: { ...settings.flowtime, breakMode: v } })
                          }
                          options={[
                            { value: 'ratio', label: t('按比例') },
                            { value: 'rules', label: t('按分段') }
                          ]}
                        />
                      </Row>

                      {settings.flowtime.breakMode === 'ratio' ? (
                        <Row label={t('休息占已专注时长的比例')}>
                          <NumInput
                            value={settings.flowtime.breakPercent}
                            min={5}
                            max={100}
                            onChange={(v) =>
                              void patch({
                                flowtime: { ...settings.flowtime, breakPercent: v }
                              })
                            }
                          />
                          <span className={styles.unit}>{t('%（最少 1 分钟）')}</span>
                        </Row>
                      ) : (
                        /*
                         * 分段规则只让改「休息多久」：
                         * 区间边界是精心设计的默认值（<30 / 30–60 / >60），
                         * 开放编辑会引入缝隙与重叠，用户很难自己修好。
                         */
                        settings.flowtime.breakRules.map((rule, i) => (
                          <Row
                            key={i}
                            label={
                              rule.maxMinutes === null
                                ? t('超过 {min} 分钟', { min: rule.minMinutes })
                                : t('{min}–{max} 分钟', {
                                    min: rule.minMinutes,
                                    max: rule.maxMinutes
                                  })
                            }
                          >
                            <NumInput
                              value={rule.breakMinutes}
                              min={1}
                              max={180}
                              onChange={(v) => {
                                const rules = settings.flowtime.breakRules.map((r, j) =>
                                  j === i ? { ...r, breakMinutes: v } : r
                                )
                                void patch({ flowtime: { ...settings.flowtime, breakRules: rules } })
                              }}
                            />
                            <span className={styles.unit}>{t('分钟休息')}</span>
                          </Row>
                        ))
                      )}
                    </>
                  )}
                </>
              )}
            </Section>

            {/* ================= 空闲检测 ================= */}
            <Section title={t('空闲检测')}>
              <Row label={t('启用')}>
                <Toggle
                  checked={settings.idle.enabled}
                  onChange={(v) => void patch({ idle: { ...settings.idle, enabled: v } })}
                />
              </Row>
              <Row label={t('最小空闲时长')}>
                <NumInput
                  value={settings.idle.minMinutes}
                  min={1}
                  max={120}
                  onChange={(v) => void patch({ idle: { ...settings.idle, minMinutes: v } })}
                />
                <span className={styles.unit}>{t('分钟')}</span>
              </Row>
              <Row label={t('说明')}>
                <span className={styles.note}>
                  {t('离开超过这个时长再回来，会问你要不要把这段时间从统计里去掉。')}
                </span>
              </Row>
            </Section>

            {/* ================= 专注音效 ================= */}
            <Section title={t('专注音效')}>
              <Row label={t('环境音')}>
                <Choice
                  value={settings.focusSound}
                  onChange={(v) => void patch({ focusSound: v })}
                  options={[
                    { value: 'off', label: t('关闭') },
                    { value: 'tick', label: t('滴答') },
                    { value: 'whiteNoise', label: t('白噪音') }
                  ]}
                />
              </Row>
              {settings.focusSound !== 'off' && (
                <Row label={t('音量')}>
                  <input
                    className={styles.range}
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(settings.focusSoundVolume * 100)}
                    onChange={(e) =>
                      void patch({ focusSoundVolume: Number(e.target.value) / 100 })
                    }
                  />
                  <span className={styles.value}>
                    {Math.round(settings.focusSoundVolume * 100)}%
                  </span>
                </Row>
              )}
              <Row label={t('说明')}>
                <span className={styles.note}>{t('只在专注进行中播放，暂停或休息会自动静音。')}</span>
              </Row>
            </Section>

            <Section title={t('行为')}>
              <Row label={t('每日番茄上限')}>
                <NumInput
                  value={settings.dailyPomodoroLimit}
                  min={1}
                  max={50}
                  onChange={(v) => void patch({ dailyPomodoroLimit: v })}
                />
              </Row>
              <Row label={t('自动开始下一阶段')}>
                <Toggle
                  checked={settings.autoStartNextPhase}
                  onChange={(v) => void patch({ autoStartNextPhase: v })}
                />
              </Row>
              <Row label={t('提示音')}>
                <Toggle
                  checked={settings.soundEnabled}
                  onChange={(v) => void patch({ soundEnabled: v })}
                />
              </Row>
              <Row label={t('音量')}>
                <input
                  className={styles.range}
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings.soundVolume * 100)}
                  onChange={(e) => void patch({ soundVolume: Number(e.target.value) / 100 })}
                />
                <span className={styles.value}>{Math.round(settings.soundVolume * 100)}%</span>
              </Row>
              <Row label={t('严格模式（专注中不可暂停）')}>
                <div className={styles.rowWithHint}>
                  <Toggle
                    checked={settings.strictMode}
                    onChange={(v) => void patch({ strictMode: v })}
                  />
                  {settings.strictMode && (
                    <span className={styles.hint}>
                      <IconLock size={12} />
                      {t('强行退出会记入中断次数')}
                    </span>
                  )}
                </div>
              </Row>
            </Section>
          </>
        )}

        {/* ================= 日程 ================= */}
        {group === 'schedule' && (
          <>
            <Section title={t('日历')}>
              <Row label={t('每周起始日')}>
                <div className={styles.segGroup}>
                  <button
                    className={styles.segBtn}
                    data-active={settings.weekStartsOn === 1 ? 'true' : 'false'}
                    onClick={() => void patch({ weekStartsOn: 1 })}
                  >
                    {t('周一')}
                  </button>
                  <button
                    className={styles.segBtn}
                    data-active={settings.weekStartsOn === 0 ? 'true' : 'false'}
                    onClick={() => void patch({ weekStartsOn: 0 })}
                  >
                    {t('周日')}
                  </button>
                </div>
              </Row>
              <Row label={t('默认任务时长')}>
                <NumInput
                  value={settings.defaultTaskMinutes}
                  min={5}
                  max={600}
                  onChange={(v) => void patch({ defaultTaskMinutes: v })}
                />
                <span className={styles.unit}>{t('分钟')}</span>
              </Row>
            </Section>

            <Section title={t('勿扰时段')}>
              <Row label={t('启用')}>
                <Toggle
                  checked={settings.dndEnabled}
                  onChange={(v) => void patch({ dndEnabled: v })}
                />
              </Row>
              {settings.dndEnabled && (
                <Row label={t('时段')}>
                  <input
                    className={styles.timeInput}
                    type="time"
                    value={settings.dnd.from}
                    onChange={(e) =>
                      void patch({ dnd: { ...settings.dnd, from: e.target.value } })
                    }
                  />
                  <span className={styles.dash}>—</span>
                  <input
                    className={styles.timeInput}
                    type="time"
                    value={settings.dnd.to}
                    onChange={(e) => void patch({ dnd: { ...settings.dnd, to: e.target.value } })}
                  />
                </Row>
              )}
            </Section>

            <Section title={t('窗口')}>
              <Row label={platformInfo?.chrome.titleBarStyle === 'hiddenInset' ? t('关闭窗口时保留在{place}', { place: platformInfo?.platformLabel === 'macOS' ? t('菜单栏') : t('托盘') }) : t('关闭窗口时最小化')}>
                <Toggle
                  checked={settings.closeToTray}
                  onChange={async (v) => {
                    await patch({ closeToTray: v })
                  }}
                />
              </Row>
              <Row label={t('开机自启')}>
                <Toggle
                  checked={settings.openAtLogin}
                  onChange={async (v) => {
                    const r = await window.api.sys.setLoginItem(v)
                    if (r.ok) await patch({ openAtLogin: r.data })
                  }}
                />
              </Row>
            </Section>
          </>
        )}

        {/* ================= 提醒 ================= */}
        {group === 'notify' && (
          <Section title={t('系统通知')}>
            <Row label={t('阶段完成')}>
              <Toggle
                checked={settings.notifications.phaseDone}
                onChange={(v) =>
                  void patch({
                    notifications: { ...settings.notifications, phaseDone: v }
                  })
                }
              />
            </Row>
            <Row label={t('任务番茄达标')}>
              <Toggle
                checked={settings.notifications.taskGoalReached}
                onChange={(v) =>
                  void patch({
                    notifications: { ...settings.notifications, taskGoalReached: v }
                  })
                }
              />
            </Row>
            <Row label={t('每日目标达成')}>
              <Toggle
                checked={settings.notifications.dailyGoalReached}
                onChange={(v) =>
                  void patch({
                    notifications: { ...settings.notifications, dailyGoalReached: v }
                  })
                }
              />
            </Row>
            <Row label={t('提前量')}>
              <NumInput
                value={settings.notifications.leadMinutes}
                min={0}
                max={120}
                onChange={(v) =>
                  void patch({
                    notifications: { ...settings.notifications, leadMinutes: v }
                  })
                }
              />
              <span className={styles.unit}>{t('分钟')}</span>
            </Row>
            <p className={styles.note}>
              <IconBell size={12} />
              {t('勿扰时段内不弹通知，专注计时不受影响。')}
            </p>
          </Section>
        )}

        {/* ================= 数据 ================= */}
        {group === 'data' && (
          <>
            <Section title={t('备份')}>
              <Row label={t('导出')}>
                <button
                  className={styles.btnGhost}
                  onClick={async () => {
                    const r = await window.api.sys.exportData()
                    if (r.ok) toast(t('已导出 {path}', { path: r.data }), 'success')
                    else toast(r.error, 'error')
                  }}
                >
                  <IconDownload size={14} />
                  <span>{t('导出 JSON')}</span>
                </button>
              </Row>
              <Row label={t('导入')}>
                <button
                  className={styles.btnGhost}
                  onClick={async () => {
                    const r = await window.api.sys.importData()
                    if (r.ok && r.data.ok) {
                      toast(r.data.message, 'success')
                      location.reload()
                    } else if (!r.ok) toast(r.error, 'error')
                    else toast(r.data.message, 'error')
                  }}
                >
                  <IconUpload size={14} />
                  <span>{t('选择文件导入')}</span>
                </button>
              </Row>
              {legacyMigrated && (
                <p className={styles.note}>
                  <IconCheck size={12} />
                  {t('已从旧版统计数据迁移完成，原文件保留未删除。')}
                </p>
              )}
            </Section>

            <Section title={t('存储')}>
              <Row label={t('数据目录')}>
                <button
                  className={styles.btnGhost}
                  onClick={() => void window.api.sys.openDataDir()}
                >
                  <IconFolder size={14} />
                  <span>{t('打开目录')}</span>
                </button>
              </Row>
              {sys && <p className={styles.path}>{sys.dataFile}</p>}
              <Row label={t('清空全部数据')}>
                <button
                  className={styles.btnDanger}
                  onClick={() =>
                    /*
                     * ⚠️ 用应用内二次确认，不用原生 window.confirm ——
                     *    原生框会阻塞渲染进程、样式不可控，在 Electron 里还会卡住动画。
                     *    这是全应用最后一个原生确认框。
                     */
                    askConfirm({
                      title: t('清空全部数据'),
                      message: t('这会删除全部任务、统计与设置，且不可撤销。确定继续吗？'),
                      confirmLabel: t('清空数据'),
                      danger: true,
                      onConfirm: async () => {
                        const r = await window.api.sys.clearData()
                        if (r.ok) {
                          toast(t('数据已清空'), 'success')
                          setTimeout(() => location.reload(), 600)
                        } else {
                          toast(r.error ?? t('操作失败'), 'error')
                        }
                      }
                    })
                  }
                >
                  <IconTrash size={14} />
                  <span>{t('清空数据')}</span>
                </button>
              </Row>
            </Section>
          </>
        )}

        {/* ================= 关于 ================= */}
        {group === 'about' && (
          <>
            <Section title={t('版本')}>
              <Row label="FocusOS">
                <span className={styles.mono}>
                  {platformInfo?.version ?? '—'}
                  {platformInfo?.build && platformInfo.build !== platformInfo.version
                    ? ` (${platformInfo.build})`
                    : ''}
                </span>
              </Row>
              <Row label={t('平台')}>
                <span className={styles.mono}>
                  {platformInfo?.platformLabel ?? '—'} · Electron{' '}
                  {platformInfo?.electron ?? '—'}
                </span>
              </Row>
              <Row label={t('窗口装饰')}>
                <span className={styles.mono}>
                  {platformInfo?.chrome.titleBarStyle ?? '—'}
                  {platformInfo?.chrome.vibrancy ? ' + vibrancy' : ''}
                  {platformInfo?.chrome.backgroundMaterial
                    ? ` + ${platformInfo.chrome.backgroundMaterial}`
                    : ''}
                </span>
              </Row>
            </Section>

            <Section title={t('快捷键总览')}>
              <p className={styles.note}>{t('按键符号已按当前平台渲染')}</p>
              {sys?.shortcutHints.map((h: { accelerator: string; label: string }) => (
                <Row key={h.accelerator} label={shortcutLabel(h.accelerator, t)}>
                  <kbd className={styles.kbd}>{h.label}</kbd>
                </Row>
              ))}
              <Row label={t('开始 / 暂停')}>
                <kbd className={styles.kbd}>{t('空格')}</kbd>
              </Row>
              <Row label={t('重置')}>
                <kbd className={styles.kbd}>R</kbd>
              </Row>
              <Row label={t('立即休息')}>
                <kbd className={styles.kbd}>B</kbd>
              </Row>
              <Row label={t('跳过阶段')}>
                <kbd className={styles.kbd}>S</kbd>
              </Row>
              <Row label={t('全屏')}>
                <kbd className={styles.kbd}>F</kbd>
              </Row>
              <Row label={t('新建任务')}>
                <kbd className={styles.kbd}>N</kbd>
              </Row>
              <Row label={t('搜索')}>
                <kbd className={styles.kbd}>/</kbd>
              </Row>
              <Row label={t('切换主题')}>
                <kbd className={styles.kbd}>T</kbd>
              </Row>
              <Row label={t('快捷键速查')}>
                <kbd className={styles.kbd}>{prettyAccelerator('CmdOrCtrl+/')}</kbd>
              </Row>
            </Section>
          </>
        )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
//  小组件
// ============================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}

/**
 * 分段选择（枚举型设置）。
 * ⭐ 用一排小按钮而不是 <select>：选项通常只有 2–3 个，
 *    按钮能一眼看全所有选项，也省掉一次展开动作。
 */
function Choice<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className={styles.choiceGroup}>
      {options.map((o) => (
        <button
          key={o.value}
          className={styles.choiceBtn}
          data-active={value === o.value ? 'true' : 'false'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  disabled = false
}: {
  checked: boolean
  onChange: (v: boolean) => void
  /** 上级开关关闭时置灰；此时点击无任何效果 */
  disabled?: boolean
}) {
  return (
    <button
      className={styles.toggle}
      data-on={checked ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className={styles.toggleKnob} />
    </button>
  )
}

function NumInput({
  value, min, max, onChange
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <input
      className={styles.numberInput}
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))))
      }}
    />
  )
}

function shortcutLabel(accelerator: string, t: ReturnType<typeof useT>): string {
  const map: Record<string, string> = {
    'CmdOrCtrl+Shift+Space': t('开始 / 暂停'),
    'CmdOrCtrl+Shift+F': t('全屏专注'),
    'CmdOrCtrl+Shift+N': t('新建任务'),
    'CmdOrCtrl+Shift+D': t('今日日程')
  }
  return map[accelerator] ?? accelerator
}
