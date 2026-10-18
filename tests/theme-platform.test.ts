// ============================================================
//  主题解析 + 平台能力降级 单测
// ============================================================
import { describe, it, expect } from 'vitest'
import { resolveTheme, isNightWindow, windowBackground, themeSource } from '@shared/theme-resolver'
import { defaultSettings } from '@shared/defaults'
import {
  keyLabel,
  prettyAccelerator,
  windowChrome,
  trayIconAsset,
  trayIconPointSize,
  chimeAsset,
  trayNoun,
  sleepNoun,
  defaultCloseToTray,
  trayTitleBudget,
  supportsTitleBarOverlayOptions,
  supportsVibrancyOptions,
  fontStack,
  platformLabel,
  isMac,
  isWin
} from '@shared/platform'

const s = defaultSettings()

/** 构造某个本地时刻的时间戳 */
function at(hour: number, minute = 0): number {
  const d = new Date(2026, 9, 14, hour, minute, 0, 0)
  return d.getTime()
}

describe('主题解析', () => {
  it('强制模式直接生效，不看系统', () => {
    const sys = { shouldUseDarkColors: false }
    expect(resolveTheme('dark', s, sys, at(12))).toBe('dark')
    expect(resolveTheme('light', s, { shouldUseDarkColors: true }, at(12))).toBe('light')
  })

  it('system 模式跟随系统', () => {
    expect(resolveTheme('system', s, { shouldUseDarkColors: true }, at(12))).toBe('dark')
    expect(resolveTheme('system', s, { shouldUseDarkColors: false }, at(12))).toBe('light')
  })

  it('autoSwitch 关闭时纯跟随系统', () => {
    const cfg = { ...s, autoSwitch: false }
    // 夜间时刻 22:00，但系统是浅色 → 仍应是浅色
    expect(resolveTheme('system', cfg, { shouldUseDarkColors: false }, at(22))).toBe('light')
  })

  it('autoSwitch 开启时夜间强制深色', () => {
    const cfg = { ...s, autoSwitch: true, autoDarkFrom: '20:00', autoLightFrom: '07:00' }
    // 系统浅色，但 22:00 属于夜间
    expect(resolveTheme('system', cfg, { shouldUseDarkColors: false }, at(22))).toBe('dark')
    expect(resolveTheme('system', cfg, { shouldUseDarkColors: false }, at(3))).toBe('dark')
  })

  it('autoSwitch 开启时白天强制浅色', () => {
    const cfg = { ...s, autoSwitch: true, autoDarkFrom: '20:00', autoLightFrom: '07:00' }
    expect(resolveTheme('system', cfg, { shouldUseDarkColors: true }, at(12))).toBe('light')
  })

  it('强制模式优先于 autoSwitch', () => {
    const cfg = { ...s, autoSwitch: true }
    expect(resolveTheme('light', cfg, { shouldUseDarkColors: true }, at(22))).toBe('light')
  })

  it('自定义不跨零点的夜间窗口', () => {
    // 夜间 01:00–06:00
    expect(isNightWindow(at(2), '01:00', '06:00')).toBe(true)
    expect(isNightWindow(at(12), '01:00', '06:00')).toBe(false)
    expect(isNightWindow(at(23), '01:00', '06:00')).toBe(false)
  })

  it('from == to 视为无效配置', () => {
    expect(isNightWindow(at(12), '08:00', '08:00')).toBeNull()
  })

  it('窗口背景色与 themes.css 的 --bg 一致', () => {
    expect(windowBackground('dark')).toBe('#1C1C1E')
    expect(windowBackground('light')).toBe('#F2F3F7')
  })

  it('themeSource 与模式一致', () => {
    expect(themeSource('system')).toBe('system')
    expect(themeSource('dark')).toBe('dark')
  })
})

describe('平台能力降级 —— 字体与快捷键文案', () => {
  it('fontStack 按平台返回不同字体栈', () => {
    const stack = fontStack()
    expect(stack.length).toBeGreaterThan(0)
    if (isMac) {
      expect(stack).toContain('-apple-system')
      expect(stack).toContain('PingFang SC')
    } else {
      expect(stack).toContain('Segoe UI')
    }
  })

  it('keyLabel 返回本平台正确的按键符号', () => {
    const mod = keyLabel('mod')
    if (isMac) expect(mod).toBe('⌘')
    else expect(mod).toBe('Ctrl')
  })

  it('prettyAccelerator 渲染 CmdOrCtrl+Shift+Space', () => {
    const pretty = prettyAccelerator('CmdOrCtrl+Shift+Space')
    if (isMac) expect(pretty).toBe('⌘⇧Space')
    else expect(pretty).toBe('Ctrl+Shift+Space')
    expect(pretty).toContain(keyLabel('mod'))
  })

  it('系统术语按平台措辞', () => {
    expect(trayNoun()).toBe(isMac ? '菜单栏' : '托盘')
    expect(sleepNoun()).toBe(isMac ? '睡眠' : '休眠')
  })
})

describe('平台能力降级 —— 窗口装饰', () => {
  it('macOS 走 hiddenInset + 红绿灯留白 + vibrancy', () => {
    if (!isMac) return
    const c = windowChrome('dark')
    expect(c.titleBarStyle).toBe('hiddenInset')
    expect(c.vibrancy).toBe('sidebar')
    expect(c.titleBarOverlay).toBeUndefined()

    /*
     * trafficLightPad 是**垂直**留白，只由侧栏内部消费。
     * ⚠️ 上界 52：macOS 红绿灯垂直占据约 y=14–41，留白超过 52 会在侧栏顶部
     *    留出一段明显的空档（用户实测反馈过「没有撑满，上面还有空隙」）。
     * ⚠️ 下界 40：低于 40 会让红绿灯压住侧栏品牌行。
     */
    expect(c.trafficLightPad).toBeGreaterThanOrEqual(40)
    expect(c.trafficLightPad).toBeLessThanOrEqual(52)
  })

  it('Windows 走 hidden + titleBarOverlay，无需留白', () => {
    if (!isWin) return
    const c = windowChrome('dark')
    expect(c.titleBarStyle).toBe('hidden')
    expect(c.trafficLightPad).toBe(0)
    expect(c.titleBarOverlay).toBeDefined()
    expect(c.vibrancy).toBeUndefined()
  })

  /*
   * 红绿灯几何是「收起左栏」按钮定位的唯一依据，
   * Sidebar.module.css 里是这么算的（见该文件的注释）：
   *     按钮 left  = trafficLightRight + --hdr-gap
   *     收起宽度   = trafficLightRight + --hdr-gap × 2 + --hdr-btn
   * 于是「按钮到红绿灯的间距」恒等于「按钮到侧栏右边框的间距」——
   * 这正是用户明确提出的要求。这几个常量一旦被误改，布局就散了，
   * 因此在这里钉死。
   */
  it('macOS 红绿灯几何：最右缘 65 / 垂直中心 20（按钮定位依赖它）', () => {
    if (!isMac) return
    const c = windowChrome('dark')
    expect(c.trafficLightRight).toBe(65)
    expect(c.trafficLightCenterY).toBe(20)
  })

  it('Windows 无红绿灯：最右缘退化为 0（按钮落回普通左内边距）', () => {
    if (!isWin) return
    const c = windowChrome('dark')
    expect(c.trafficLightRight).toBe(0)
    expect(c.trafficLightCenterY).toBeGreaterThan(0)
  })

  it('两侧等距：收起宽度 = 红绿灯右缘 + 两个间隙 + 按钮宽', () => {
    const c = windowChrome('dark')
    const HDR_BTN = 26
    const HDR_GAP = 12 // 与 tokens.css 的 --hdr-btn / --hdr-gap 保持一致
    const btnLeft = c.trafficLightRight + HDR_GAP
    const collapsedWidth = c.trafficLightRight + HDR_GAP * 2 + HDR_BTN
    // 按钮左边的间隙
    expect(btnLeft - c.trafficLightRight).toBe(HDR_GAP)
    // 按钮右边的间隙
    expect(collapsedWidth - (btnLeft + HDR_BTN)).toBe(HDR_GAP)
    // 按钮不会与红绿灯重叠
    expect(btnLeft).toBeGreaterThanOrEqual(c.trafficLightRight)
  })

  it('按钮的垂直中心与红绿灯一致', () => {
    const c = windowChrome('dark')
    const HDR_BTN = 26
    const top = c.trafficLightCenterY - HDR_BTN / 2
    expect(top + HDR_BTN / 2).toBe(c.trafficLightCenterY)
  })

  it('titleBarOverlay 的 symbolColor 随主题变化且不同', () => {
    if (!isWin) return
    const dark = windowChrome('dark').titleBarOverlay!
    const light = windowChrome('light').titleBarOverlay!
    expect(dark.symbolColor).not.toBe(light.symbolColor)
    expect(dark.color).not.toBe(light.color)
  })
})

describe('平台能力降级 —— 托盘与提示音', () => {
  it('macOS 托盘用 Template 变体', () => {
    const t = trayIconAsset('dark')
    if (isMac) {
      expect(t.isTemplate).toBe(true)
      expect(t.file).toBe('trayTemplate.png')
    } else {
      expect(t.isTemplate).toBe(false)
    }
  })

  it('Windows 托盘深浅两套随主题切换', () => {
    const dark = trayIconAsset('dark')
    const light = trayIconAsset('light')
    if (!isWin) return
    expect(dark.file).not.toBe(light.file)
    // 深色主题 → 用浅色图标（白方框），浅色主题反之
    expect(dark.file).toBe('trayWin-light.png')
    expect(light.file).toBe('trayWin-dark.png')
  })

  it('托盘/提示音只返回文件名，绝不含绝对路径', () => {
    // ⚠️ 本模块被渲染层 import，不能依赖 node:path，
    //    绝对路径一律由主进程 path.join(buildDir(), file) 组装。
    for (const a of [trayIconAsset('dark'), trayIconAsset('light')]) {
      expect(a.file).not.toContain('/')
      expect(a.file).not.toContain('\\')
    }
  })

  it('两平台提示音统一为自带 chime.wav', () => {
    const c = chimeAsset()
    expect(c.format).toBe('wav')
    expect(c.file).toBe('chime.wav')
    // ⭐ 禁止依赖系统音
    expect(c.file).not.toContain('System/Library')
  })

  it('托盘图标渲染尺寸按平台取标准值', () => {
    // macOS 菜单栏与 Windows 通知区标准槽位均为 16
    expect(trayIconPointSize()).toBe(16)
  })

  it('Windows 托盘标题空间紧张时只显示分钟数', () => {
    expect(trayTitleBudget()).toBe(isMac ? 'full' : 'minutes-only')
  })
})

describe('平台能力降级 —— 设置项条件显示', () => {
  it('titleBarOverlay 相关选项仅 Windows 可见', () => {
    expect(supportsTitleBarOverlayOptions()).toBe(isWin)
    expect(supportsTitleBarOverlayOptions()).toBe(!isMac || isWin ? true : false)
  })

  it('vibrancy 相关选项仅 macOS 可见', () => {
    expect(supportsVibrancyOptions()).toBe(isMac)
  })

  it('关窗默认行为按平台区分', () => {
    // macOS 用户习惯关窗留托盘；Windows 用户习惯关窗即退出
    expect(defaultCloseToTray()).toBe(isMac)
  })

  it('platformLabel 返回可读平台名', () => {
    expect(platformLabel()).toMatch(/macOS|Windows|linux|freebsd/i)
  })

  it('isMac / isWin 互斥', () => {
    expect(isMac && isWin).toBe(false)
  })
})
