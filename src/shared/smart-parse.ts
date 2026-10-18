// ============================================================
//  smart-parse.ts — 智能解析输入 ○
// ============================================================
//  输入形如「明天下午3点 和张三 开会 1小时 重要」
//  尝试解析出日期 / 时间 / 时长 / 优先级 / 标签。
//  ⭐ 做不出来要优雅降级为纯文本创建 —— 本模块永不抛错。
// ============================================================
import type { Priority } from './types'

export interface ParsedDraft {
  title: string
  date: string | null
  startTime?: string
  endTime?: string
  priority: Priority
  tags: string[]
  /** 供 UI 展示的可确认 chips */
  chips: { kind: string; label: string }[]
  /** 是否真的解析出了东西 */
  matched: boolean
}

const WEEKDAY: Record<string, number> = {
  周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 0,
  星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6, 星期日: 0
}

const PRIORITY_WORDS: { word: string; value: Priority; label: string }[] = [
  { word: '重要', value: 2, label: '高优先级' },
  { word: '紧急', value: 2, label: '高优先级' },
  { word: '最高', value: 2, label: '高优先级' },
  { word: '一般', value: 1, label: '中优先级' },
  { word: '普通', value: 1, label: '中优先级' },
  { word: '低', value: 0, label: '低优先级' },
  { word: '不急', value: 0, label: '低优先级' }
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 解析 `@` 后面的记号。
 *
 * 支持：@今天 @明天 @后天 @大后天 @周五 @下周三 @3/15 @3月15日 @2026-11-05 @9:30 @15:00
 *
 * ⭐ 为什么要单独做一套 @ 语法（而不是只靠中文自然语言）：
 *    「@3/15 对账」里的 3/15 一定是日期，但同一串数字也可能是标题里的数据
 *    （「Q3/15 报表」）。打了 @ 就是在明确说「这是日期」，
 *    误判率比让正则去猜低得多，输入也更快。
 * @returns null 表示这个记号不是日期/时间（当作普通文本处理）
 */
function parseAtToken(
  token: string,
  today: Date
): { date: Date | null; hour: number | null; minute: number } | null {
  const t = token.trim()
  if (!t) return null

  // 纯时间：9:30 / 15:00
  const tm = /^(\d{1,2})[:：](\d{2})$/.exec(t)
  if (tm) {
    const h = Number(tm[1])
    const m = Number(tm[2])
    if (h <= 23 && m <= 59) return { date: null, hour: h, minute: m }
  }

  // 相对日
  const rel: Record<string, number> = {
    今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3
  }
  if (t in rel) {
    const d = new Date(today)
    d.setDate(d.getDate() + rel[t])
    return { date: d, hour: null, minute: 0 }
  }

  // 周几 / 下周几
  const isNext = t.startsWith('下')
  const dow = WEEKDAY[isNext ? t.slice(1) : t]
  if (dow !== undefined) {
    const d = new Date(today)
    const cur = d.getDay()
    let delta = (dow - cur + 7) % 7
    // 说「周三」且今天就是周三 → 指下周
    if (delta === 0) delta = 7
    if (isNext) delta += 7
    d.setDate(d.getDate() + delta)
    return { date: d, hour: null, minute: 0 }
  }

  // 具体日期：2026-11-05 / 3月15日 / 3/15
  const dm =
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t) ??
    /^(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]$/.exec(t) ??
    /^(\d{1,2})\/(\d{1,2})$/.exec(t)
  if (dm) {
    let y: number
    let mo: number
    let day: number
    if (dm.length === 4) {
      y = Number(dm[1])
      mo = Number(dm[2])
      day = Number(dm[3])
    } else {
      y = today.getFullYear()
      mo = Number(dm[1])
      day = Number(dm[2])
    }
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
      const d = new Date(y, mo - 1, day)
      if (!Number.isNaN(d.getTime())) return { date: d, hour: null, minute: 0 }
    }
  }

  return null
}

/**
 * 解析自然语言输入。
 * 任何一步失败都只是少解析一个字段，绝不抛异常。
 */
export function smartParse(input: string, today: Date = new Date()): ParsedDraft {
  const raw = input.trim()
  const result: ParsedDraft = {
    title: raw,
    date: null,
    priority: 1,
    tags: [],
    chips: [],
    matched: false
  }
  if (!raw) return result

  let text = raw
  const consumed: { start: number; end: number }[] = []
  /** 标记一段文本已被解析，后续从标题中剔除 */
  const eat = (start: number, end: number) => {
    consumed.push({ start, end })
  }

  // ---------------- 日期 ----------------
  let date: Date | null = null
  /** @ 前缀直接给出的时间（如 @9:30） */
  let atTime: { hour: number; minute: number } | null = null

  /*
   * ⭐ @ 前缀优先于中文自然语言解析。
   *    用户打了 @ 就是在明确声明「这是日期」，此时不该再让后面的
   *    「3月15日 / 周五 / 明天」等规则去猜 —— 猜错反而把标题里的
   *    数字吃掉，比不解析更糟。
   */
  const atHit = /@([^\s@#]+)/.exec(text)
  if (atHit && atHit.index !== undefined) {
    const parsed = parseAtToken(atHit[1], today)
    if (parsed) {
      if (parsed.date) {
        date = parsed.date
        result.chips.push({ kind: 'date', label: `@${atHit[1]}` })
      }
      if (parsed.hour !== null) {
        atTime = { hour: parsed.hour, minute: parsed.minute }
        result.chips.push({ kind: 'time', label: `@${atHit[1]}` })
      }
      eat(atHit.index, atHit.index + atHit[0].length)
    }
  }

  // 今天 / 明天 / 后天 / 大后天
  const relDays: { re: RegExp; add: number; label: string }[] = [
    { re: /大后天/, add: 3, label: '大后天' },
    { re: /后天/, add: 2, label: '后天' },
    { re: /明天|明日/, add: 1, label: '明天' },
    { re: /今天|今日/, add: 0, label: '今天' }
  ]
  for (const { re, add, label } of relDays) {
    if (date) break
    const m = text.match(re)
    if (m && m.index !== undefined) {
      const d = new Date(today)
      d.setDate(d.getDate() + add)
      date = d
      result.chips.push({ kind: 'date', label: `${label} ${toKey(d)}` })
      eat(m.index, m.index + m[0].length)
      break
    }
  }

  // 星期几：下周三 / 周五
  if (!date) {
    for (const [word, dow] of Object.entries(WEEKDAY)) {
      const idx = text.indexOf(word)
      if (idx === -1) continue
      const d = new Date(today)
      const cur = d.getDay()
      let delta = (dow - cur + 7) % 7
      if (delta === 0) delta = 7 // 说「周三」且今天就是周三 → 下周三
      d.setDate(d.getDate() + delta)
      date = d
      result.chips.push({ kind: 'date', label: `${word} ${toKey(d)}` })
      eat(idx, idx + word.length)
      break
    }
  }

  // 具体日期：3/15、3月15日、2026-10-14
  if (!date) {
    const m =
      text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/) ??
      text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/) ??
      text.match(/(\d{1,2})\/(\d{1,2})/)
    if (m && m.index !== undefined) {
      let y: number
      let mo: number
      let d: number
      if (m.length === 4 && m[1].length === 4) {
        y = Number(m[1]); mo = Number(m[2]); d = Number(m[3])
      } else {
        y = today.getFullYear(); mo = Number(m[1]); d = Number(m[2])
      }
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        const dt = new Date(y, mo - 1, d)
        if (!Number.isNaN(dt.getTime())) {
          date = dt
          result.chips.push({ kind: 'date', label: toKey(dt) })
          eat(m.index, m.index + m[0].length)
        }
      }
    }
  }

  // ---------------- 时间 ----------------
  let hour: number | null = null
  let minute = 0
  let hasMeridiem = false

  if (atTime) {
    /*
     * @ 已经给出时间 → 直接采用，不再去正文里找。
     * 否则「@9:30 和客户对表」里的「和」可能被后面的规则当成上午标记。
     */
    hour = atTime.hour
    minute = atTime.minute
  } else {
    // 下午3点 / 晚上8点半 / 上午9:30 / 15:30
    const meridiem = text.match(/(上午|早上|早晨|中午|下午|晚上|夜里|傍晚)/)
    if (meridiem && meridiem.index !== undefined) {
      hasMeridiem = true
      eat(meridiem.index, meridiem.index + meridiem[0].length)
      const w = meridiem[1]
      if (w === '下午' || w === '晚上' || w === '夜里' || w === '傍晚') {
        // 标记为下午，具体小时在解析数字时修正
      }
    }

    // 「8点半」优先于「8点(8)」，否则点号后的数字会被误当成分钟
    const timeMatch =
      text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/) ??
      text.match(/(\d{1,2})\s*[点时]半/) ??
      text.match(/(\d{1,2})\s*[点时](\d{1,2})\s*分?/) ??
      text.match(/(\d{1,2})\s*[点时]/)

    if (timeMatch && timeMatch.index !== undefined) {
      hour = Number(timeMatch[1])

      if (/半/.test(timeMatch[0])) {
        minute = 30
      } else if (timeMatch[2] !== undefined) {
        const mm = Number(timeMatch[2])
        minute = Number.isFinite(mm) ? Math.min(59, mm) : 0
      }

      // 下午修正：下午3点 → 15 点
      if (hasMeridiem && hour !== null && hour < 12) {
        const w = meridiem![1]
        if (w === '下午' || w === '晚上' || w === '夜里' || w === '傍晚') hour += 12
        if (w === '中午' && hour < 12) hour = 12
      }
      if (hour !== null && (hour < 0 || hour > 23)) hour = null
      if (minute > 59) minute = 0

      eat(timeMatch.index, timeMatch.index + timeMatch[0].length)
    }
  }

  // ---------------- 时长 ----------------
  /*
   * 中文「1小时 / 90分钟」与英文简写「30m / 2h / 1.5h」都认。
   * ⚠️ 英文单位后面必须接非字母（(?![a-zA-Z])），
   *    否则「3months」会被当成 3 分钟。
   */
  let durationMin: number | null = null
  const durMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(小时|时|分钟|分|hours?|hrs?|h|minutes?|mins?|min|m)(?![a-zA-Z])/i
  )
  if (durMatch && durMatch.index !== undefined) {
    const n = Number(durMatch[1])
    const unit = durMatch[2]
    if (!Number.isNaN(n) && n > 0) {
      durationMin = /小时|时|h/i.test(unit) ? Math.round(n * 60) : Math.round(n)
      result.chips.push({ kind: 'duration', label: `${durMatch[0]}` })
      eat(durMatch.index, durMatch.index + durMatch[0].length)
    }
  }

  // ---------------- 优先级 ----------------
  for (const { word, value, label } of PRIORITY_WORDS) {
    const idx = text.indexOf(word)
    if (idx === -1) continue
    result.priority = value
    result.chips.push({ kind: 'priority', label })
    eat(idx, idx + word.length)
    break
  }

  // ---------------- 标签 ----------------
  const tagRe = /#([^\s#]+)/g
  let tm: RegExpExecArray | null
  while ((tm = tagRe.exec(text)) !== null) {
    result.tags.push(tm[1])
    eat(tm.index, tm.index + tm[0].length)
  }

  // ---------------- 组装标题 ----------------
  if (consumed.length > 0) {
    consumed.sort((a, b) => a.start - b.start)
    let title = ''
    let cursor = 0
    for (const c of consumed) {
      if (c.start > cursor) title += text.slice(cursor, c.start)
      cursor = Math.max(cursor, c.end)
    }
    title += text.slice(cursor)
    title = title.replace(/\s+/g, ' ').trim()
    // 去掉「和张三 开会」这类残留的连接词开头
    title = title.replace(/^[和与跟及]\s*/, '')
    if (title) result.title = title
  }

  // ---------------- 应用 ----------------
  if (date) {
    result.date = toKey(date)
    if (hour !== null) {
      const startMin = hour * 60 + minute
      result.startTime = `${pad(hour)}:${pad(minute)}`
      const end = startMin + (durationMin ?? 60)
      result.endTime = `${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`
    } else if (durationMin) {
      // 只有时长没有开始时间 → 默认从当前整点/下一整点起
      const now = new Date(today)
      const startMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15
      result.startTime = `${pad(Math.floor(startMin / 60) % 24)}:${pad(startMin % 60)}`
      const end = startMin + durationMin
      result.endTime = `${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`
    }
  } else if (hour !== null) {
    result.startTime = `${pad(hour)}:${pad(minute)}`
    result.endTime = `${pad(Math.floor((hour * 60 + minute + (durationMin ?? 60)) / 60) % 24)}:${pad((hour * 60 + minute + (durationMin ?? 60)) % 60)}`
  }

  result.matched = result.chips.length > 0
  return result
}
