// ============================================================
//  FocusView.tsx — 专注视图（阶段徽章 / 倒计时 / 环形进度 /
//                  控制按钮 / 当前任务胶囊 / 今日进度点阵）
// ============================================================
//  ⭐ 背景模式：本地图片全铺 + object-fit: cover，
//     纯 CSS 实现，绝不调用 sips / ImageMagick 等外部命令。
//     主题联动：文字颜色随背景亮度自动反转（canvas 采样）。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTimer } from '../../hooks/useTimer'
import { useFocusSound } from '../../hooks/useFocusSound'
import { useDataStore } from '../../stores/useDataStore'
import { todayKey } from '../../stores/useUIStore'
import { useThemeStore } from '../../stores/useThemeStore'
import { useT } from '../../i18n'
import { mediaUrl } from '@shared/media'
import { RingProgress } from './RingProgress'
import { BackgroundFX } from './BackgroundFX'
import { TimeWheelPicker, type PickerAnchor } from './TimeWheelPicker'
import {
  IconPlay, IconPause, IconReset, IconSkip, IconCoffee, IconCheck
} from '../common/Icons'
import { orderBackgrounds, activeBackground, nextBackgroundIndex } from '@shared/backgrounds'
import { PHASE_LABEL } from '@shared/defaults'
import { todayFocusCount } from '../../stores/useDataStore'
import styles from './FocusView.module.css'

interface Props {
  /** 小窗 or 全屏 */
  compact: boolean
}

/** 采样背景图平均亮度，判断该用黑字还是白字 */
function useBackgroundLuminance(url: string | null): number | null {
  const [lum, setLum] = useState<number | null>(null)

  useEffect(() => {
    if (!url) {
      setLum(null)
      return
    }
    const img = new Image()
    // 走 CORS 请求，否则自定义协议图片会污染 canvas，getImageData 直接抛错
    img.crossOrigin = 'anonymous'
    img.src = url
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = 32
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data
        let total = 0
        let n = 0
        for (let i = 0; i < data.length; i += 4) {
          total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
          n++
        }
        setLum(total / n / 255)
      } catch {
        // 跨源或读取失败时退回主题色
        setLum(null)
      }
    }
    img.onerror = () => setLum(null)
  }, [url])

  return lum
}

export function FocusView({ compact }: Props) {
  const t = useT()
  const { timer, start, pause, reset, skip, breakNow, finishFlow, isRunning } = useTimer()
  const tasks = useDataStore((s) => s.tasks)
  const stats = useDataStore((s) => s.dailyStats)
  const backgrounds = useDataStore((s) => s.backgrounds)
  const settings = useDataStore((s) => s.settings)
  const effective = useThemeStore((s) => s.effective)

  // ---- 背景模式 ----
  // 用户拖拽排序后的展示顺序（未列进 order 的新图自动追加在末尾）
  const ordered = useMemo(
    () => orderBackgrounds(backgrounds, settings.background.order),
    [backgrounds, settings.background.order]
  )
  const rotate = settings.background.rotate
  const bgEnabled = settings.background.enabled && ordered.length > 0

  const [bgIndex, setBgIndex] = useState(0)
  // 关闭轮播时固定显示第一张
  const bgUrl = bgEnabled ? activeBackground(ordered, rotate, bgIndex) : null

  useEffect(() => {
    // 未开启轮播：重置游标并完全不启动定时器
    if (!bgEnabled || !rotate) {
      setBgIndex(0)
      return
    }
    const id = setInterval(
      () => setBgIndex((i) => nextBackgroundIndex(i, ordered.length, rotate)),
      Math.max(5, settings.background.rotateSeconds) * 1000
    )
    return () => clearInterval(id)
  }, [bgEnabled, rotate, settings.background.rotateSeconds, ordered.length])

  const luminance = useBackgroundLuminance(bgUrl ? mediaUrl(bgUrl) : null)

  // ---- 空闲淡出（全屏态）----
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (compact) return
    let timerId: number | undefined
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timerId)
      // 鼠标静止 3 秒后所有控件淡出
      timerId = window.setTimeout(() => setIdle(true), 3000)
    }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.clearTimeout(timerId)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [compact])

  // ---- 阶段切换光晕 ----
  const [glow, setGlow] = useState(false)
  const prevPhase = useRef(timer.phase)
  useEffect(() => {
    if (prevPhase.current !== timer.phase) {
      prevPhase.current = timer.phase
      setGlow(true)
      const id = setTimeout(() => setGlow(false), 2000)
      return () => clearTimeout(id)
    }
  }, [timer.phase])

  // ---- 倒计时动画 key：切换阶段时重新触发 blur 淡入 ----
  const [animKey, setAnimKey] = useState(0)
  useEffect(() => {
    setAnimKey((k) => k + 1)
  }, [timer.phase])

  const total = useMemo(() => {
    if (timer.phase === 'focus') return settings.durations.workMinutes * 60
    if (timer.phase === 'shortBreak') return settings.durations.shortBreakMinutes * 60
    return settings.durations.longBreakMinutes * 60
  }, [timer.phase, settings.durations])

  /*
   * 心流模式。
   * ⚠️ 判据用 settings.focusMode 而不是 timer.countingUp：
   *    countingUp 只在「正在跑」时为真，而 IDLE / 暂停时界面也要显示 00:00 的正计时，
   *    否则用户切到心流后看到的还是「25:00」那个倒计时，会以为没生效。
   */
  const flowFocus = settings.focusMode === 'flowtime' && timer.phase === 'focus'
  const displaySeconds = flowFocus ? timer.elapsedSeconds : timer.remainingSeconds

  /*
   * 专注环境音（滴答 / 白噪音）。
   * ⚠️ active 的判据是「专注阶段 + 正在跑」：暂停、休息、停止都会立刻静音 ——
   *    按了暂停滴答还在响，用户会以为按钮坏了。
   */
  useFocusSound(
    settings.focusSound,
    settings.focusSoundVolume,
    timer.phase === 'focus' && timer.status === 'RUNNING'
  )

  // 心流没有目标时长 → 环形不表示进度（空环），而不是假装走了一圈
  const progress = flowFocus ? 0 : total > 0 ? 1 - timer.remainingSeconds / total : 0
  const today = todayKey()
  const done = todayFocusCount(stats, today)
  const limit = settings.dailyPomodoroLimit

  const currentTask = tasks.find((t) => t.id === timer.taskId) ?? null

  // ------------------------------------------------------------
  //  分 / 秒 手动设置
  // ------------------------------------------------------------
  //  ⭐ 只改「这一轮」：走 timer.setDuration，不写回 settings。
  //     引擎会在 reset / 跳过 / 阶段切换后自动作废这次改写。
  type WheelField = 'min' | 'sec'
  const [wheel, setWheel] = useState<{
    field: WheelField
    anchor: PickerAnchor
    /** 打开瞬间冻结的值 —— 倒计时每秒在走，不能跟着跳，否则滚轮会被一秒一次地拽回原位 */
    value: number
  } | null>(null)
  const minRef = useRef<HTMLButtonElement>(null)
  const secRef = useRef<HTMLButtonElement>(null)
  /** 取「此刻」的剩余秒数用 ref：回调必须保持稳定，否则滚轮每次 tick 都被重建 */
  const remainingRef = useRef(timer.remainingSeconds)
  remainingRef.current = timer.remainingSeconds
  const wheelFieldRef = useRef<WheelField | null>(null)
  wheelFieldRef.current = wheel?.field ?? null

  const openWheel = (field: WheelField) => {
    const el = field === 'min' ? minRef.current : secRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const s = remainingRef.current
    setWheel({
      field,
      anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      value: field === 'min' ? Math.floor(s / 60) : s % 60
    })
  }

  /** 滑动 / 点击选中：按「当前剩余」重算总秒数，只覆盖被改的那一位 */
  const handleWheelPick = useCallback((n: number) => {
    const field = wheelFieldRef.current
    if (!field) return
    const cur = remainingRef.current
    const next = field === 'min' ? n * 60 + (cur % 60) : Math.floor(cur / 60) * 60 + n
    // 0 秒会让计时立刻归零响铃，下限保到 1 秒
    void window.api.timer.setDuration(Math.max(1, next))
  }, [])

  const handleWheelClose = useCallback(() => setWheel(null), [])

  // ⭐ 背景模式下的文字色：按背景亮度自动判断（浅底黑字 / 深底白字）
  const bgText = useMemo(() => {
    if (!bgEnabled) return undefined
    if (!settings.background.autoTextColor || luminance === null) {
      return effective === 'dark' ? '#FFFFFF' : '#14161A'
    }
    return luminance > 0.55 ? '#14161A' : '#FFFFFF'
  }, [bgEnabled, settings.background.autoTextColor, luminance, effective])

  const ringSize = compact ? 108 : 260
  const showChrome = !bgEnabled && !idle

  /*
   * ⭐ 次级控件的显示条件必须与徽章行一致：`bgEnabled || showChrome`。
   *
   * 早先这里只写了 `showChrome`，而 showChrome 的定义是 `!bgEnabled && !idle` ——
   * 于是**一开背景模式，这行控件就永远不渲染**：重置 / 立即休息 / 跳过阶段
   * 全部消失（用户开着 10 张背景图，一直没找到过它们）。
   * 徽章行那侧用的是 `bgEnabled || showChrome ? 1 : 0`，本来就是「开背景就常显」。
   * 这里与它对齐；沉浸淡出（idle）仍只影响「没有背景」时的那种观感。
   */
  const showControls = bgEnabled || showChrome

  const overlay = settings.background.overlay / 100
  const blur = settings.background.blur
  const vignette = settings.background.vignette / 100

  return (
    <div
      className={styles.root}
      data-compact={compact ? 'true' : 'false'}
      data-bg={bgEnabled ? 'true' : 'false'}
      style={
        {
          '--bg-text': bgText ?? 'var(--text-1)',
          '--bg-overlay': String(overlay),
          '--bg-blur': `${blur}px`,
          '--bg-vignette': String(vignette),
          '--glow-color': timer.phase === 'focus' ? 'var(--focus)' : 'var(--break)'
        } as React.CSSProperties
      }
    >
      {/*
       * ⭐ 窗口拖拽条只保留顶部这一条（与其它页面顶栏同高）。
       *    早先整页挂 data-drag：pointerdown 会在系统层被当成「拖窗口」吃掉，
       *    点击涟漪（window 捕获 pointerdown）永远收不到事件 ——
       *    用户实测反馈「点击涟漪没反应」。
       *    现在只有这条退出渲染层事件，其余区域（含整张背景）点击都能泛起涟漪。
       */}
      <div className={styles.dragStrip} data-drag="1" aria-hidden="true" />

      {/* ---------- 背景层 ---------- */}
      {bgEnabled && (
        <>
          <img className={styles.bgImage} src={mediaUrl(bgUrl)} alt="" aria-hidden="true" />
          <div className={styles.bgOverlay} aria-hidden="true" />
          <div className={styles.bgVignette} aria-hidden="true" />
          {/*
           * ⭐ 氛围特效（雨点 + 点击涟漪）只在背景模式下挂载：
           *    没有背景图时下雨会显得莫名其妙，而且空跑一条 rAF 也是白耗电。
           *    雨点另受 settings.background.rain 开关控制，涟漪始终跟随背景。
           */}
          <BackgroundFX rain={settings.background.rain} rainSize={settings.background.rainSize} />
        </>
      )}

      {/* ---------- 主体：中心列垂直堆叠 ---------- */}
      <div className={styles.center}>
        {/* 阶段徽章 + 重置键 */}
        <div
          className={styles.badgeRow}
          style={{ opacity: bgEnabled || showChrome ? 1 : 0 }}
        >
          <div className={styles.badge} data-phase={timer.phase}>
            <span className={styles.badgeDot} />
            {t(PHASE_LABEL[timer.phase])}
            {timer.status === 'PAUSED' && <span className={styles.badgePaused}>{t('已暂停')}</span>}
          </div>

          {/* 回到本阶段的原始时长（专注 / 休息各自归零重来） */}
          <button
            className={styles.badgeReset}
            onClick={() => void reset()}
            title={t('重置到本阶段起始时长 R')}
            aria-label={t('重置本阶段')}
          >
            <IconReset size={15} />
          </button>
        </div>

        {/* 巨大计时：番茄钟是倒计时（分/秒可点设置），心流是正计时（只读） */}
        <div
          key={animKey}
          className={styles.countdown}
          style={{
            fontSize: compact ? 60 : 'clamp(96px, 18vw, 180px)',
            opacity: bgEnabled || showChrome ? 1 : 0
          }}
        >
          {flowFocus ? (
            <>
              {/*
                心流没有目标时长，分/秒不可点 —— 让数字看起来能点却没反应，
                比不可点更让人困惑，所以这里直接用普通文本。
              */}
              <span className={styles.segStatic}>
                {String(Math.floor(displaySeconds / 60)).padStart(2, '0')}
              </span>
              <span className={styles.colon} aria-hidden="true">
                :
              </span>
              <span className={styles.segStatic}>
                {String(displaySeconds % 60).padStart(2, '0')}
              </span>
            </>
          ) : (
            <>
              <button
                ref={minRef}
                type="button"
                className={styles.seg}
                data-active={wheel?.field === 'min' ? 'true' : 'false'}
                onClick={() => openWheel('min')}
                title={t('点击设置分钟')}
                aria-label={t('设置分钟')}
              >
                {String(Math.floor(timer.remainingSeconds / 60)).padStart(2, '0')}
              </button>
              <span className={styles.colon} aria-hidden="true">
                :
              </span>
              <button
                ref={secRef}
                type="button"
                className={styles.seg}
                data-active={wheel?.field === 'sec' ? 'true' : 'false'}
                onClick={() => openWheel('sec')}
                title={t('点击设置秒数')}
                aria-label={t('设置秒数')}
              >
                {String(timer.remainingSeconds % 60).padStart(2, '0')}
              </button>
            </>
          )}
        </div>

        {/* 心流提示：让「正在往上走」这件事有解释，否则会像倒计时坏了 */}
        {flowFocus && (
          <div className={styles.flowHint} style={{ opacity: bgEnabled || showChrome ? 1 : 0 }}>
            {t('心流模式 · 已专注 {n} 分钟', { n: Math.floor(displaySeconds / 60) })}
          </div>
        )}

        {/* 环形进度：圆心就是开始/暂停主按钮 */}
        <div style={{ opacity: bgEnabled || showChrome ? 1 : 0 }}>
          <RingProgress
            progress={progress}
            size={ringSize}
            stroke={compact ? 8 : 12}
            phase={timer.phase === 'focus' ? 'focus' : 'break'}
            glow={glow}
          >
            <button
              className={styles.ringAction}
              style={{ width: compact ? 76 : 132, height: compact ? 76 : 132 }}
              onClick={() => void (isRunning ? pause() : start())}
              title={isRunning ? t('暂停 空格') : t('开始 空格')}
              aria-label={isRunning ? t('暂停') : t('开始')}
              disabled={settings.strictMode && timer.phase === 'focus' && isRunning}
            >
              {isRunning ? (
                <IconPause size={compact ? 34 : 60} />
              ) : (
                <IconPlay size={compact ? 34 : 60} />
              )}
            </button>
          </RingProgress>
        </div>

        {/* 次级控制行：开始/暂停已移到圆心，这里不再重复 */}
        {showControls && (
          <div className={styles.controls}>
            <button className={styles.ctrlBtn} onClick={() => void reset()} title={t('重置 R')}>
              <IconReset size={18} />
            </button>

            {/*
              心流模式下「立即休息」是多余的 —— 休息时长由这一轮的实际专注时长反算，
              用户按「结束这一轮」自然就进休息了。
            */}
            {!flowFocus && (
              <button className={styles.ctrlBtn} onClick={() => void breakNow()} title={t('立即休息 B')}>
                <IconCoffee size={18} />
              </button>
            )}

            {flowFocus ? (
              <button
                className={styles.ctrlBtn}
                data-accent="true"
                onClick={() => void finishFlow()}
                title={t('结束这一轮，按已专注时长给休息')}
                aria-label={t('结束这一轮')}
              >
                <IconCheck size={18} />
              </button>
            ) : (
              <button className={styles.ctrlBtn} onClick={() => void skip()} title={t('跳过阶段 S')}>
                <IconSkip size={18} />
              </button>
            )}
          </div>
        )}

        {/* 当前任务胶囊 */}
        {showChrome && currentTask && (
          <div className={styles.taskPill}>
            <span className={styles.taskPillTitle}>{currentTask.title}</span>
            <span className={styles.taskPillMeta}>
              🍅 {currentTask.completedPomodoros}/{currentTask.estimatedPomodoros}
            </span>
          </div>
        )}

        {/* 今日进度点阵 */}
        {showChrome && (
          <div className={styles.dots} title={t('今日 {done}/{limit} 个番茄', { done, limit })}>
            {Array.from({ length: limit }).map((_, i) => (
              <span
                key={i}
                className={styles.dot}
                data-filled={i < done ? 'true' : 'false'}
                data-active={
                  timer.phase === 'focus' && i === done && isRunning ? 'true' : 'false'
                }
              />
            ))}
          </div>
        )}
      </div>

      {/*
       * 右上角「小窗 / 全屏」按钮已移除（用户要求）。
       *    · 它只在 showChrome（无背景图）时渲染，位置正好压在 Windows 的
       *      − □ ✕ 下方，截图里看就是一颗多余的悬空方块。
       *    · 功能没丢：Esc 与 F 仍可来回切换全屏/小窗（useHotkeys 里的
       *      toggle-fullscreen，以及快捷键面板里写着的那条）。
       */}

      {/*
       * 分 / 秒 滚轮选择器。
       * ⚠️ 挂在 .root 直下、而不是塞进 .countdown 里：
       *    倒计时那段有 blur 淡入动画（filter 会创建包含块），
       *    放进去会让 position: fixed 退化成相对祖先定位，弹窗位置全乱。
       */}
      {wheel && (
        <TimeWheelPicker
          anchor={wheel.anchor}
          value={wheel.value}
          max={60}
          onPick={handleWheelPick}
          onClose={handleWheelClose}
        />
      )}
    </div>
  )
}
