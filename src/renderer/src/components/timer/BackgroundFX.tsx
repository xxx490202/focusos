// ============================================================
//  BackgroundFX.tsx — 背景氛围特效（雨点 + 点击涟漪）
// ============================================================
//  两个独立的视觉层，都只铺在背景图上、不拦任何指针事件：
//
//   1. 雨丝：canvas 2D 手绘。粒子数按画布面积自适应并设硬上限，
//      4K 全屏下也不会把 CPU 拉满；每一滴用 depth 控制粗细/速度/透明度，
//      近处的又粗又快又亮，形成景深。
//   2. 涟漪：**CSS 动画而非 canvas**。一次点击只对应一个 span，
//      生命周期交给浏览器的合成层，比在 canvas 里自己维护一套
//      对象池 + 定时器简单得多，也更省电。
//
//  ⚠️ 三条必须遵守的克制：
//   · prefers-reduced-motion：整屏下落线条对前庭敏感人群不友好，
//     系统开了「减弱动态效果」就**一滴雨都不下**（涟漪交给 CSS 媒体查询处理）。
//   · document.hidden：窗口不可见时停掉 rAF，后台空转纯属耗电。
//   · 层序：特效压在 --z-content 之下 —— 雨在照片里，字在雨前面，
//     巨号倒计时始终清晰（这也比雨压在字上更像「窗外下雨」）。
// ============================================================
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { rainSizeScale } from '@shared/backgrounds'
import styles from './BackgroundFX.module.css'

/** 一滴雨。depth 越大 = 离镜头越近 */
interface Drop {
  x: number
  y: number
  /** 拖尾长度 px */
  len: number
  /** 线宽 px */
  width: number
  /** 下落速度 px/s */
  speed: number
  /** 峰值不透明度 */
  alpha: number
  /** 水平漂移比例（风），同时决定雨丝的倾斜角 */
  wind: number
}

interface Ripple {
  id: number
  x: number
  y: number
}

/** 涟漪动画时长，必须与 CSS 里的 rippleOut 保持一致 */
const RIPPLE_MS = 900

// ------------------------------------------------------------
//  雨丝
// ------------------------------------------------------------
function RainCanvas({ intensity = 1, size = 1 }: { intensity?: number; size?: number }): ReactElement {
  const ref = useRef<HTMLCanvasElement | null>(null)
  /*
   * ⭐ 大小走 ref 而不是依赖项：
   *    设置页拖滑块时不能重建整条 rAF（会闪一下、且丢掉雨幕连续性）。
   *    已落下的雨滴在下次回收重生时自然换成新尺寸，过渡是连续的。
   */
  const sizeRef = useRef(size)
  sizeRef.current = size

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 系统级「减弱动态效果」：直接不下雨，连定时器都不建
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    let w = 0
    let h = 0
    let drops: Drop[] = []
    let raf = 0
    let last = 0

    const makeDrop = (initial: boolean): Drop => {
      /*
       * depth 做一次幂次映射（^1.6）而不是线性：
       * 让画面里绝大多数是细淡的远处雨丝，只有少数又粗又亮的近景，
       * 线性分布会显得「满屏一样粗」，很假。
       */
      const depth = Math.random() ** 1.6
      return {
        // x 左右各多留 100px，风把雨吹斜时边上不会出现突兀的空缺
        x: Math.random() * (w + 200) - 100,
        // 首帧铺满整个画面，之后新雨滴一律从顶部外侧补进来
        y: initial ? Math.random() * h : -40 - Math.random() * 140,
        len: (12 + depth * 40) * sizeRef.current,
        width: (0.5 + depth * 1.2) * sizeRef.current,
        speed: 560 + depth * 900,
        alpha: 0.08 + depth * 0.3,
        wind: 0.1 + depth * 0.1
      }
    }

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      // 宿主刚挂载时可能还是 0 尺寸，等 ResizeObserver 下一次回调
      if (rect.width === 0 || rect.height === 0) return
      w = rect.width
      h = rect.height
      // 上限 2：Retina 已经够锐，再乘 3 只是白烧 GPU
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      // 位图放大 dpr 倍，绘图坐标仍按 CSS 像素走，省掉满屏的 *dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'

      const count = Math.round(Math.min(260, Math.max(70, (w * h) / 11000)) * intensity)
      drops = Array.from({ length: count }, () => makeDrop(true))
    }

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame)
      // 首帧没有参照点；长时间挂起（切回窗口）后 dt 会很大，
      // 钳到 50ms，否则雨滴会「瞬移」出画面
      const dt = last === 0 ? 0 : Math.min(0.05, (now - last) / 1000)
      last = now
      if (dt === 0 || w === 0) return

      ctx.clearRect(0, 0, w, h)
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i]
        d.y += d.speed * dt
        d.x += d.speed * d.wind * dt

        // 落到画面下方 / 被风吹出右侧 → 回收重生，绝不 new 新对象
        if (d.y - d.len > h || d.x - d.len > w + 120) {
          drops[i] = makeDrop(false)
          continue
        }

        ctx.strokeStyle = `rgba(255,255,255,${d.alpha})`
        ctx.lineWidth = d.width
        ctx.beginPath()
        ctx.moveTo(d.x, d.y)
        // 雨丝逆着风向上拖尾，倾角与漂移方向一致才不会「飘着下」
        ctx.lineTo(d.x - d.len * d.wind, d.y - d.len)
        ctx.stroke()
      }
    }

    const start = (): void => {
      if (raf) return
      last = 0
      raf = requestAnimationFrame(frame)
    }
    const stop = (): void => {
      if (!raf) return
      cancelAnimationFrame(raf)
      raf = 0
    }

    const onVisibility = (): void => (document.hidden ? stop() : start())

    // 观察**父容器**而不是 canvas 自己：canvas 的位图尺寸写在 width/height
    // 属性上，直接观察它有机会触发 resize 回环
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)
    resize()

    document.addEventListener('visibilitychange', onVisibility)
    start()

    return () => {
      stop()
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intensity])

  return <canvas ref={ref} className={styles.rain} />
}

// ------------------------------------------------------------
//  特效总成
// ------------------------------------------------------------
export function BackgroundFX({ rain, rainSize = 50 }: { rain: boolean; rainSize?: number }): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [ripples, setRipples] = useState<Ripple[]>([])
  const seq = useRef(0)

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const host = hostRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // 只认落在背景区域内的按下；窗口外或已滚出的位置直接忽略
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return

      const id = ++seq.current
      // 只保留最近 8 个：连点也不会滚出一屏 DOM
      setRipples((list) => [...list.slice(-7), { id, x, y }])
      window.setTimeout(
        () => setRipples((list) => list.filter((p) => p.id !== id)),
        RIPPLE_MS + 100
      )
    }

    /*
     * 用**捕获阶段**监听 window：任何位置的按下都要泛起涟漪
     * （包括压在按钮上的），而宿主层是 pointer-events:none，
     * 不捕获的话事件根本不会经过它。
     */
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [])

  return (
    <div ref={hostRef} className={styles.fx} aria-hidden="true">
      {rain && <RainCanvas size={rainSizeScale(rainSize)} />}
      {ripples.map((p) => (
        <span key={p.id} className={styles.ripple} style={{ left: p.x, top: p.y }} />
      ))}
    </div>
  )
}
