// ============================================================
//  global.ts — 渲染层内部类型
// ============================================================

/** system:info 通道返回的系统信息 */
export interface SystemInfo {
  today: string
  /** 数据文件绝对路径 */
  dataFile: string
  backgroundsDir: string
  /** 全局快捷键及其按平台渲染好的按键文案 */
  shortcutHints: { accelerator: string; label: string }[]
  keys: { mod: string; alt: string; shift: string }
  platform: string
  appId: string
  defaultCloseToTray: boolean
}
