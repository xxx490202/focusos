// ============================================================
//  paths.ts — 主进程路径解析
// ============================================================
//  ⚠️ 一律用 path 模块 + pathToFileURL()，禁止手写路径字符串拼接。
//     Windows 下含空格与中文的用户目录（如 C:\Users\张三\AppData\...）
//     必须能正常工作。
// ============================================================
import { app } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const isDev = !app.isPackaged

/** 项目根目录（开发态 = 仓库根，打包态 = app 根） */
export const appRoot = isDev ? join(dirname(fileURLToPath(import.meta.url)), '../..') : app.getAppPath()

/** build/ 目录（图标） */
export function buildDir(): string {
  return isDev ? join(appRoot, 'build') : join(process.resourcesPath, 'build')
}

/** resources/sounds 目录 */
export function soundsDir(): string {
  return isDev ? join(appRoot, 'resources/sounds') : join(process.resourcesPath, 'sounds')
}

/** 内置背景图目录 */
export function builtinBackgroundsDir(): string {
  return isDev ? join(appRoot, 'resources/backgrounds') : join(process.resourcesPath, 'backgrounds')
}

/** userData 下的用户自定义背景图目录 */
export function userBackgroundsDir(): string {
  return join(app.getPath('userData'), 'backgrounds')
}

export function dataFile(): string {
  return join(app.getPath('userData'), 'focusos-data.json')
}

export function iconPath(): string {
  return join(buildDir(), 'icon.png')
}

/**
 * 把本地绝对路径转成 file:// URL 给渲染层。
 * ⭐ 必须走 pathToFileURL，否则中文/空格路径会失效。
 */
export function toFileUrl(absolutePath: string): string {
  return pathToFileURL(absolutePath).toString()
}

/**
 * macOS 包内 Info.plist 的 CFBundleVersion（build-app.sh 写入的构建号）。
 * 开发态没有包结构，返回 'dev'；非 macOS 平台返回空串。
 * 用于「关于」页显示，方便用户核对拿到的是哪一次构建。
 * ⭐ 结果缓存：platformInfo 会随每次 bootstrap 调用，不能反复起子进程。
 */
let cachedBuildNumber: string | null = null

export function appBuildNumber(): string {
  if (cachedBuildNumber !== null) return cachedBuildNumber
  if (!app.isPackaged) return (cachedBuildNumber = 'dev')
  if (process.platform !== 'darwin') return (cachedBuildNumber = '')
  try {
    const plist = join(dirname(process.execPath), '..', 'Info.plist')
    cachedBuildNumber = execFileSync(
      '/usr/bin/plutil',
      ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist],
      { encoding: 'utf8' }
    ).trim()
  } catch {
    cachedBuildNumber = ''
  }
  return cachedBuildNumber
}

/** 提示音 file:// URL */
export function soundUrl(): string {
  const p = join(soundsDir(), 'chime.wav')
  return existsSync(p) ? toFileUrl(p) : ''
}

/** 列出所有可用背景图（内置 + 用户导入），返回 file:// URL 列表 */
export function listBackgrounds(): string[] {
  const out: string[] = []
  for (const dir of [builtinBackgroundsDir(), userBackgroundsDir()]) {
    try {
      if (!existsSync(dir)) continue
      for (const name of readdirSync(dir)) {
        if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(name)) continue
        out.push(toFileUrl(join(dir, name)))
      }
    } catch {
      // 目录不可读则跳过
    }
  }
  return out
}

export { isDev }
