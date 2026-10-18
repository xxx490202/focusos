// ============================================================
//  media-protocol.ts — 本地媒体资源协议
// ============================================================
//  开发模式下渲染层由 http://localhost:5173 提供，Chromium 的
//  webSecurity 不允许该源加载 file://（表现为缩略图裂图、提示音不响）；
//  打包模式下页面本身是 file://，能加载，但两条路径行为不一致。
//
//  这里注册 focusos-media://，只暴露背景图与提示音所在目录，
//  让 dev 与打包态走同一条加载路径。
//
//  URL 形如：focusos-media://local/?p=<encodeURIComponent(绝对路径)>
//  ⭐ 用查询参数而不是路径段：Windows 盘符、中文、空格都不会被
//     URL 解析器改写（路径段里的反斜杠会被当成斜杠处理）。
// ============================================================
import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { builtinBackgroundsDir, userBackgroundsDir, soundsDir } from './paths'

export const MEDIA_SCHEME = 'focusos-media'

/**
 * 必须在 app ready 之前调用 —— Electron 对 privileged scheme 的注册时机
 * 有硬性要求，ready 之后注册不会生效。
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // 背景亮度采样要 readPixels：跨源资源必须允许 CORS，否则 canvas 被污染
        corsEnabled: true
      }
    }
  ])
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.wav': 'audio/wav'
}

/** 允许读取的目录：只放背景图与提示音，协议不能变成任意文件读取器 */
function allowedRoots(): string[] {
  return [builtinBackgroundsDir(), userBackgroundsDir(), soundsDir()].map((d) => resolve(d))
}

function isAllowed(file: string): boolean {
  return allowedRoots().some((root) => file === root || file.startsWith(root + sep))
}

/** app ready 之后调用 */
export function installMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let file: string
    try {
      const p = new URL(request.url).searchParams.get('p')
      if (!p) return new Response('Bad Request', { status: 400 })
      file = resolve(p)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    if (!isAllowed(file)) return new Response('Forbidden', { status: 403 })

    try {
      const data = await readFile(file)
      return new Response(data, {
        headers: {
          'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'access-control-allow-origin': '*'
        }
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}
