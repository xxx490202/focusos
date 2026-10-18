/**
 * ============================================================
 *  platform.ts — 双平台能力抽象层（地基）
 * ============================================================
 *  ⚠️ 全工程唯一的平台差异收敛点。
 *  组件、业务逻辑、样式表中禁止出现 process.platform / isMac /
 *  .icns / .exe / /System/Library / AppData 等平台字样。
 *  新增平台相关能力时，先在这里加能力函数，再在消费处调用。
 *
 *  ⚠️ 本模块同时被主进程与渲染层 import，因此**禁止 import electron**。
 *     Electron 运行时相关的部分通过可选注入实现（见 setPowerSource / setShell）。
 * ============================================================
 */

// ---- 平台标识 ----

/**
 * 探测当前运行平台。
 *
 * ⚠️ 本模块同时被主进程与渲染层 import，两边的取法**必须不同**：
 *   · 主进程（Node）：process.platform 直接可用
 *   · 渲染层：contextIsolation + sandbox 下页面里根本没有 process。
 *     若在顶层直接写 `process.platform`，渲染层会在模块初始化阶段就抛
 *     `ReferenceError: process is not defined`，导致整个 React 树无法挂载、
 *     窗口全白。这是本项目踩过的真实坑，务必保留这里的环境判断。
 *   · 渲染层改用 Electron 固定注入的 userAgent 推断 —— Electron 的 UA
 *     一定带 Macintosh / Windows / Linux 标识，且不会被业务代码改写。
 *
 * ⭐ 顺带解决了「交叉打包」问题：平台由**运行时**决定，
 *    而不是构建机，Windows 产物即使在 macOS 上打出来也不会认错平台。
 */
function detectPlatform(): string {
  const g = globalThis as {
    process?: { platform?: string }
    navigator?: { userAgent?: string }
  }

  const fromNode = g.process?.platform
  if (typeof fromNode === 'string' && fromNode.length > 0) return fromNode

  const ua = g.navigator?.userAgent ?? ''
  if (/Macintosh|Mac OS X|Darwin/i.test(ua)) return 'darwin'
  if (/Windows|Win32|Win64/i.test(ua)) return 'win32'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return 'unknown'
}

const PLATFORM = detectPlatform()

export const isMac = PLATFORM === 'darwin'
export const isWin = PLATFORM === 'win32'

// ---- 系统色（随主题变化，供 overlay 按钮等使用） ----
export interface SystemColors {
  bg: string
  symbol: string
  hover: string
}

const DARK_SYSTEM: SystemColors = {
  bg: '#1C1C1E',
  symbol: '#C7C7CC',
  hover: '#3A3A3C'
}
const LIGHT_SYSTEM: SystemColors = {
  bg: '#F2F3F7',
  symbol: '#4B5058',
  hover: '#E4E6EC'
}

// ---- 字体栈（渲染层消费） ----
export function fontStack(): string {
  return isMac
    ? '-apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", system-ui, sans-serif'
    : '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif'
}

// ---- 快捷键标签（UI 文案用，底层仍是 CmdOrCtrl） ----
export function keyLabel(key: 'mod' | 'alt' | 'shift'): string {
  if (isMac) {
    if (key === 'mod') return '⌘'
    if (key === 'alt') return '⌥'
    return '⇧'
  }
  if (key === 'mod') return 'Ctrl'
  if (key === 'alt') return 'Alt'
  return 'Shift'
}

/** 把 accelerator 串转成平台按键符号文案，如 CmdOrCtrl+Shift+Space */
export function prettyAccelerator(accel: string): string {
  return accel
    .split('+')
    .map((part) => {
      const k = part.trim()
      if (k === 'CmdOrCtrl' || k === 'CommandOrControl') return keyLabel('mod')
      if (k === 'Cmd' || k === 'Command') return '⌘'
      if (k === 'Alt' || k === 'Option') return keyLabel('alt')
      if (k === 'Shift') return keyLabel('shift')
      if (k === 'Space') return isMac ? 'Space' : 'Space'
      return k
    })
    .join(isMac ? '' : '+')
}

// ---- 窗口装饰 ----
export interface WindowChrome {
  titleBarStyle: 'hiddenInset' | 'hidden'
  titleBarOverlay?: { color: string; symbolColor: string; height: number }
  trafficLightPad: number
  /**
   * 红绿灯（系统窗口按钮）最右侧的**可见边缘**在窗口坐标系里的 x，单位 px。
   *
   * ⚠️ 这是实测值，不是系统 API。macOS 三颗灯的可见圆点自 x=13 起、
   *    间距 20、直径 12，故最右缘落在 13 + 40 + 12 = 65。
   *    Windows 没有红绿灯（窗口按钮在右上角），取 0 ——
   *    Sidebar.module.css 里的 `--traffic-right` 会随之退化成普通的左内边距。
   */
  trafficLightRight: number
  /**
   * 红绿灯在窗口坐标系里的**垂直中心** y，单位 px。
   * macOS 实测 20；Windows 用 titleBarOverlay 的高度 32 取半。
   */
  trafficLightCenterY: number
  backgroundMaterial?: 'acrylic' | 'mica' | undefined
  vibrancy?: 'sidebar' | undefined
}

/** 标题栏 overlay 需要跟随主题重算，因此每次调用都返回最新值 */
export function windowChrome(effectiveTheme: 'light' | 'dark' = 'dark'): WindowChrome {
  const sys = effectiveTheme === 'dark' ? DARK_SYSTEM : LIGHT_SYSTEM
  if (isMac) {
    return {
      titleBarStyle: 'hiddenInset',
      /**
       * ⚠️ 这是**垂直方向**留给红绿灯的高度，不是水平缩进。
       *    macOS 红绿灯垂直占据约 y=13–27，取 44 即可让出（含余量，
       *    也顺便容下与红绿灯同高的「收起左栏」按钮）。
       *    早先取 78 偏大，且被错误地加在整个工作台上，
       *    导致窗口顶部露出一条异色空带（用户实测反馈）。
       *    现在由 Sidebar.module.css 的 .root 内部消化，内容区从 y=0 开始。
       */
      trafficLightPad: 44,
      trafficLightRight: 65,
      trafficLightCenterY: 20,
      vibrancy: 'sidebar'
    }
  }
  return {
    titleBarStyle: 'hidden',
    /*
     * ⭐ color 传**全透明**（#RRGGBBAA）而不是 sys.bg。
     *   原来给的是不透明的系统灰（#1C1C1E / #F2F3F7），
     *   三者按钮后面就会浮出一块纯色矩形，压在渐变/背景图上像贴了张纸
     *   （用户实测反馈「背景颜色好突兀」）。
     *   透明后 overlay 只剩按钮本身，底下的自绘界面透出来，边界消失。
     *   symbolColor 仍要跟随主题，否则按钮符号会与背景撞色。
     */
    titleBarOverlay: { color: '#00000000', symbolColor: sys.symbol, height: 32 },
    trafficLightPad: 0,
    trafficLightRight: 0,
    trafficLightCenterY: 16,
    // 仅 Win11 (build 22621+) 支持 acrylic/mica，Win10 由调用方置 undefined
    backgroundMaterial: supportsAcrylic() ? 'acrylic' : undefined
  }
}

function supportsAcrylic(): boolean {
  if (!isWin) return false
  // Windows 11 起始 build 号 22000；22621 为 22H2。取保守下界。
  const release = typeof os_release === 'string' ? Number.parseFloat(os_release) : 0
  return release >= 10
}

/** 系统版本号（主进程注入 os.release；渲染层为 0） */
let os_release = ''

// ---- 托盘图标 ----
export interface TrayAsset {
  /**
   * build/ 目录下的**文件名**。
   * ⚠️ 这里刻意不返回绝对路径：本模块同时被渲染层 import，
   *    不能依赖 node:path。绝对路径由主进程用 path.join(buildDir(), file)
   *    组装（见 main/tray.ts），避免手写路径字符串拼接。
   */
  file: string
  isTemplate: boolean
}

/**
 * @param effectiveTheme Windows 下需要深浅两套跟随主题
 */
export function trayIconAsset(effectiveTheme: 'light' | 'dark' = 'dark'): TrayAsset {
  if (isMac) {
    return { file: 'trayTemplate.png', isTemplate: true }
  }
  return {
    file: `trayWin-${effectiveTheme === 'dark' ? 'light' : 'dark'}.png`,
    isTemplate: false
  }
}

/**
 * 托盘/菜单栏图标的**渲染尺寸**（单位：点/pt）。
 *
 * ⚠️ 必须在主进程显式 resize 到这个值，不能只用素材的像素尺寸：
 *    macOS 的 NSImage.size 直接取 PNG 像素数当 pt 用，
 *    一张 44×44 的素材会被画成 44pt —— 而菜单栏只有约 24pt 高，
 *    图标会直接撑爆菜单栏（用户实测反馈「托盘图标太大了」）。
 *    Windows 通知区同理，标准槽位是 16px。
 *
 * 素材本身按 @2x（32px）生成以保留清晰度，这里统一压回 16pt。
 */
export function trayIconPointSize(): number {
  return 16
}

// ---- 提示音资源 ----
export interface ChimeAsset {
  /** 同上：只给文件名，绝对路径由主进程拼装 */
  file: string
  format: 'wav' | 'aiff' | 'mp3'
}

/** ⚠️ 两平台统一用自带 chime.wav，禁止依赖 /System/Library/Sounds（Windows 上不存在） */
export function chimeAsset(): ChimeAsset {
  return { file: 'chime.wav', format: 'wav' }
}

// ---- 电源 / 唤醒事件订阅 ★ ----
type Unsubscribe = () => void

/**
 * ⚠️ powerMonitor 的 suspend/resume 只有 macOS 有；
 *    Windows / Linux 只有 lock-screen / unlock-screen。
 *    Windows 上锁屏 ≠ 睡眠（锁屏时进程仍在运行），但作为「可能发生大幅时间跳跃」
 *    的信号做一次校正是合理的。
 *    计时精度本身不依赖这些事件（endsAt - Date.now() 差值计算），
 *    事件只用于「补响漏掉的阶段提示音」。
 */
export function onWake(handler: () => void): Unsubscribe {
  const pm = getPowerMonitor()
  if (!pm) return () => {}
  if (isMac) {
    pm.on('suspend', handler)
    pm.on('resume', handler)
    return () => {
      pm.removeListener('suspend', handler)
      pm.removeListener('resume', handler)
    }
  }
  // Windows：锁屏 / 解锁作为近似触发点
  pm.on('lock-screen', handler)
  pm.on('unlock-screen', handler)
  return () => {
    pm.removeListener('lock-screen', handler)
    pm.removeListener('unlock-screen', handler)
  }
}

/** 电源事件类型（与 electron powerMonitor 对齐） */
export type PowerEvent = 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen'

interface PowerMonitorLike {
  on(event: PowerEvent, handler: () => void): unknown
  removeListener(event: PowerEvent, handler: () => void): unknown
}

let powerMonitorRef: PowerMonitorLike | null = null

/** 主进程在 app ready 后注入，避免本模块 import electron */
export function setPowerSource(pm: PowerMonitorLike | null): void {
  powerMonitorRef = pm
}

function getPowerMonitor(): PowerMonitorLike | null {
  return powerMonitorRef
}

// ---- 系统集成 ----
export interface ShellLike {
  openPath(target: string): Promise<string>
  openExternal(url: string): Promise<void>
}

let shellRef: ShellLike | null = null
export function setShell(shell: ShellLike | null): void {
  shellRef = shell
}

/** 两平台都用 shell.openPath */
export function openDataDir(): Promise<string> {
  return shellRef ? shellRef.openPath('') : Promise.resolve('')
}

export function openExternal(url: string): Promise<void> {
  return shellRef ? shellRef.openExternal(url) : Promise.resolve()
}

export function setOsRelease(release: string): void {
  os_release = release
}

// ---- 关闭行为默认值（按平台区分） ----
/** macOS 用户习惯关窗留托盘；Windows 用户习惯关窗即退出 */
export function defaultCloseToTray(): boolean {
  return isMac
}

/**
 * Windows 下要不要撤掉 Electron 的默认菜单栏（文件/编辑/视图/窗口/帮助）。
 *
 * ⭐ 这一排菜单是**原生绘制**的，会压在自绘界面的最上层：
 *    · 它和窗口控制按钮（− □ ✕）一样不属于网页内容，CSS 挪不动它；
 *    · 用户实测看到「关于(A)」这类菜单项盖在界面左上角。
 *    撤掉后界面只剩自绘顶栏，交互入口统一到托盘右键菜单里。
 *
 * macOS 保留：那里的菜单栏在屏幕顶部、属于系统栏，不在窗口内，
 *    且「关于 / 退出 / 快捷键」是 Mac 用户的预期入口，不能撤。
 */
export function suppressDefaultMenu(): boolean {
  return isWin
}

// ---- 菜单栏 / 托盘术语（按平台措辞） ----
export function trayNoun(): string {
  return isMac ? '菜单栏' : '托盘'
}

/** 系统级术语：mac 说「睡眠」，Windows 说「休眠」 */
export function sleepNoun(): string {
  return isMac ? '睡眠' : '休眠'
}

/** Windows 托盘空间不足时可只显示分钟数 */
export function trayTitleBudget(): 'full' | 'minutes-only' {
  return isMac ? 'full' : 'minutes-only'
}

// ---- 平台标签（设置页「关于」用） ----
export function platformLabel(): string {
  if (isMac) return 'macOS'
  if (isWin) return 'Windows'
  return PLATFORM === 'unknown' ? '未知平台' : PLATFORM
}

/**
 * 归一化的平台键，供 PlatformInfo.os 使用。
 * ⭐ 之所以要这一层，是为了让 process.platform 只出现在本文件，
 *    主进程与渲染层都不需要再碰平台字符串。
 */
export function platformKey(): 'darwin' | 'win32' | 'other' {
  if (isMac) return 'darwin'
  if (isWin) return 'win32'
  return 'other'
}

// ---- 设置项条件显示（F10：不要向用户暴露当前平台不支持的选项） ----
export function supportsTitleBarOverlayOptions(): boolean {
  return isWin
}

export function supportsVibrancyOptions(): boolean {
  return isMac
}

export function supportsMaterialOptions(): boolean {
  return isWin
}

// ---- 应用名（通知等需要，Windows 通知需 appId） ----
export function appId(): string {
  return 'com.focusos.app'
}
