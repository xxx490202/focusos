// ============================================================
//  idle-watcher.ts — 空闲检测（主进程）
// ============================================================
//  ⭐ 解决的问题：人离开电脑去吃饭/开会，倒计时照跑、番茄照算，
//    统计因此虚高。这里把「离开了多久」测出来，交给渲染层问用户怎么算。
//
//  实现要点：
//  · 用 Electron 原生的 powerMonitor.getSystemIdleTime()（秒），
//    跨平台，不需要任何额外依赖或权限
//  · **轮询 + 边沿触发**：连续 idle 越过阈值时进入「离开中」，
//    一旦回到阈值以下（说明用户动了鼠标/键盘）才上报一次 ——
//    会话中途反复弹窗比不弹更烦
//  · 上报的是这段离开里的**峰值** idle，而不是回归瞬间的值（那时已经是 0）
//
//  ⚠️ 本模块只负责「测出来并广播」，不做任何业务判断：
//    计时器是不是在跑、要不要弹窗、怎么补偿，全部由渲染层决定。
//    这样主进程不必反向依赖 app-controller，也避免循环引用。
// ============================================================
import { powerMonitor } from 'electron'
import { windows } from './window'
import { scopedLogger } from './store/logger'

const log = scopedLogger('idle')

/** 探测间隔。5 秒足够精确，又不至于太频繁 */
const POLL_MS = 5_000
/** 少于这个秒数不打扰用户（阈值调得很小时不至于一直弹） */
const MIN_REPORT_SECONDS = 30
/** 阈值的下限：低于半分钟的空闲没有补偿意义 */
const MIN_THRESHOLD_SECONDS = 30

class IdleWatcher {
  private timer: NodeJS.Timeout | null = null
  private enabled = false
  private thresholdSeconds = 300

  /** 上一次轮询到的 idle 秒数 */
  private lastIdleSec = 0
  /** 本轮「离开」中的峰值 idle 秒数 */
  private peakIdleSec = 0

  /** 按设置热更新（开关 / 阈值都能立即生效） */
  configure(opts: { enabled: boolean; minMinutes: number }): void {
    this.enabled = opts.enabled
    this.thresholdSeconds = Math.max(
      MIN_THRESHOLD_SECONDS,
      Math.round(opts.minMinutes * 60)
    )
    if (this.enabled) this.start()
    else this.stop()
  }

  private start(): void {
    if (this.timer) return
    this.lastIdleSec = 0
    this.peakIdleSec = 0
    this.timer = setInterval(() => this.poll(), POLL_MS)
    log.info(`空闲检测已启用，阈值 ${Math.round(this.thresholdSeconds / 60)} 分钟`)
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.lastIdleSec = 0
    this.peakIdleSec = 0
  }

  private poll(): void {
    if (!this.enabled) return

    let idleSec: number
    try {
      idleSec = powerMonitor.getSystemIdleTime()
    } catch (err) {
      /*
       * 少数 Linux 桌面环境拿不到系统空闲时间。
       * 直接停掉并提示一次 —— 继续每秒抛异常只会刷屏，
       * 而用户看到的只是「功能开着但从不生效」，更难排查。
       */
      log.warn('系统不支持空闲检测，已自动关闭', err)
      this.enabled = false
      this.stop()
      return
    }

    const wasAway = this.lastIdleSec >= this.thresholdSeconds
    const isAway = idleSec >= this.thresholdSeconds

    // 从「离开中」回到「在线」→ 用户刚回来，上报这一段
    if (wasAway && !isAway) {
      const away = Math.round(this.peakIdleSec)
      this.peakIdleSec = 0
      if (away >= MIN_REPORT_SECONDS) this.report(away)
    } else if (isAway) {
      this.peakIdleSec = Math.max(this.peakIdleSec, idleSec)
    }

    this.lastIdleSec = idleSec
  }

  private report(seconds: number): void {
    windows.broadcast('push:idle', { seconds })
  }
}

export const idleWatcher = new IdleWatcher()
