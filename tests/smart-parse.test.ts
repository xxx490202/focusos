// ============================================================
//  smart-parse.test.ts — 智能解析 ○ 单测
// ============================================================
import { describe, it, expect } from 'vitest'
import { smartParse } from '@shared/smart-parse'

// 固定「今天」为 2026-10-14（周三）
const TODAY = new Date(2026, 9, 14, 10, 0, 0)

describe('智能解析 — 日期', () => {
  it('解析「明天」', () => {
    const r = smartParse('明天 和张三 开会', TODAY)
    expect(r.date).toBe('2026-10-15')
    expect(r.title).toContain('开会')
    expect(r.matched).toBe(true)
  })

  it('解析「后天」「今天」', () => {
    expect(smartParse('今天写周报', TODAY).date).toBe('2026-10-14')
    expect(smartParse('后天体检', TODAY).date).toBe('2026-10-16')
  })

  it('解析「下周五」为下一个周五', () => {
    // 2026-10-14 是周三，下一个周五是 10-16
    const r = smartParse('周五 复盘', TODAY)
    expect(r.date).toBe('2026-10-16')
  })

  it('说「周三」且今天就是周三 → 下周三', () => {
    const r = smartParse('周三例会', TODAY)
    expect(r.date).toBe('2026-10-21')
  })

  it('解析具体日期 10月20日', () => {
    const r = smartParse('10月20日 交付', TODAY)
    expect(r.date).toBe('2026-10-20')
  })

  it('解析完整日期 2026-11-05', () => {
    expect(smartParse('2026-11-05 上线', TODAY).date).toBe('2026-11-05')
  })
})

describe('智能解析 — 时间与时长', () => {
  it('解析「下午3点」为 15:00', () => {
    const r = smartParse('明天下午3点 面试', TODAY)
    expect(r.startTime).toBe('15:00')
    expect(r.date).toBe('2026-10-15')
  })

  it('解析「上午9点30」', () => {
    const r = smartParse('明天上午9点30 晨会', TODAY)
    expect(r.startTime).toBe('09:30')
  })

  it('解析「晚上8点半」为 20:30', () => {
    const r = smartParse('今天晚上8点半 电影', TODAY)
    expect(r.startTime).toBe('20:30')
  })

  it('解析「15:30」冒号格式', () => {
    const r = smartParse('明天15:30 沟通', TODAY)
    expect(r.startTime).toBe('15:30')
  })

  it('时长「1小时」换算为结束时间', () => {
    const r = smartParse('明天下午2点 开会 1小时', TODAY)
    expect(r.startTime).toBe('14:00')
    expect(r.endTime).toBe('15:00')
  })

  it('时长「90分钟」', () => {
    const r = smartParse('明天10点 深度工作 90分钟', TODAY)
    expect(r.startTime).toBe('10:00')
    expect(r.endTime).toBe('11:30')
  })
})

describe('智能解析 — 优先级与标签', () => {
  it('解析「重要」为高优先级', () => {
    const r = smartParse('明天 交付 重要', TODAY)
    expect(r.priority).toBe(2)
    expect(r.chips.some((c) => c.kind === 'priority')).toBe(true)
  })

  it('解析「不急」为低优先级', () => {
    expect(smartParse('下周 整理 不急', TODAY).priority).toBe(0)
  })

  it('未提及优先级时默认中', () => {
    expect(smartParse('随手记一下', TODAY).priority).toBe(1)
  })

  it('解析 #标签', () => {
    const r = smartParse('明天写方案 #工作 #重要', TODAY)
    expect(r.tags).toContain('工作')
    expect(r.tags).toContain('重要')
  })
})

describe('智能解析 — 优雅降级', () => {
  it('无法解析时原样作为标题', () => {
    const r = smartParse('随便写点什么', TODAY)
    expect(r.title).toBe('随便写点什么')
    expect(r.matched).toBe(false)
    expect(r.date).toBeNull()
  })

  it('空输入不抛错', () => {
    const r = smartParse('', TODAY)
    expect(r.title).toBe('')
    expect(r.matched).toBe(false)
  })

  it('纯数字不产生非法时间', () => {
    const r = smartParse('999999', TODAY)
    expect(r.startTime).toBeUndefined()
  })

  it('非法日期被忽略而非崩溃', () => {
    const r = smartParse('99月99日 做事', TODAY)
    expect(r.matched).toBe(false)
  })

  it('规范示例：明天下午3点 和张三 开会 1小时 重要', () => {
    const r = smartParse('明天下午3点 和张三 开会 1小时 重要', TODAY)
    expect(r.date).toBe('2026-10-15')
    expect(r.startTime).toBe('15:00')
    expect(r.endTime).toBe('16:00')
    expect(r.priority).toBe(2)
    expect(r.title).toContain('张三')
    expect(r.title).toContain('开会')
    // 解析出的时间片段不应残留在标题里
    expect(r.title).not.toContain('下午')
    expect(r.title).not.toContain('1小时')
    expect(r.title).not.toContain('重要')
  })
})
