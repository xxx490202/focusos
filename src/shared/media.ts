// ============================================================
//  media.ts — 本地媒体 URL 转换
// ============================================================
//  主进程扫描出的背景图 / 提示音是 file:// URL，但开发模式下页面来自
//  http://localhost:5173，Chromium 会拒绝该源加载 file://。
//  展示前统一转成 focusos-media://（见 main/media-protocol.ts），
//  dev 与打包态行为一致。
//
//  ⭐ 只转换「展示用」的 URL；settings.background.order / hidden 里
//     持久化的仍然是原始 file:// 字符串，主进程的比较逻辑不受影响。
// ============================================================

const FILE_PREFIX = 'file://'

export function mediaUrl(url: string | null | undefined): string {
  if (!url || !url.startsWith(FILE_PREFIX)) return url ?? ''

  try {
    // pathToFileURL 在 Windows 上产出 file:///C:/...，去掉盘符前的多余斜杠
    const abs = decodeURIComponent(url.slice(FILE_PREFIX.length)).replace(
      /^\/([A-Za-z]:)/,
      '$1'
    )
    return `focusos-media://local/?p=${encodeURIComponent(abs)}`
  } catch {
    // 非法百分号编码：原样返回，让浏览器自己报错
    return url
  }
}
