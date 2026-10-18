// ============================================================
//  media.test.ts — file:// → focusos-media:// 转换
// ============================================================
//  开发模式下页面是 http 源，Chromium 不允许加载 file://；
//  展示前必须统一转成自定义协议。这里锁住几条容易出错的规则：
//  中文/空格不能丢、Windows 盘符前的多余斜杠要去掉、非 file 协议原样返回。
// ============================================================
import { describe, it, expect } from 'vitest'
import { mediaUrl } from '@shared/media'

const wrap = (abs: string): string =>
  `focusos-media://local/?p=${encodeURIComponent(abs)}`

describe('mediaUrl', () => {
  it('空值返回空字符串', () => {
    expect(mediaUrl(null)).toBe('')
    expect(mediaUrl(undefined)).toBe('')
    expect(mediaUrl('')).toBe('')
  })

  it('非 file 协议原样返回', () => {
    expect(mediaUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
    expect(mediaUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(mediaUrl('focusos-media://local/?p=x')).toBe('focusos-media://local/?p=x')
  })

  it('普通 mac 路径转成查询参数形式', () => {
    expect(mediaUrl('file:///Users/xx/a.png')).toBe(wrap('/Users/xx/a.png'))
  })

  it('⭐ 中文与空格路径经解码后重新编码，不能出现二次转义', () => {
    const encoded = 'file:///Users/xx/%E7%95%AA%E8%8C%84%E9%92%9F/a%20b.png'
    expect(mediaUrl(encoded)).toBe(wrap('/Users/xx/番茄钟/a b.png'))
  })

  it('Windows 盘符前的多余斜杠要去掉', () => {
    expect(mediaUrl('file:///C:/Users/a.png')).toBe(wrap('C:/Users/a.png'))
  })

  it('非法百分号编码时退回原值', () => {
    expect(mediaUrl('file:///bad/%E0%A4%A.png')).toBe('file:///bad/%E0%A4%A.png')
  })
})
