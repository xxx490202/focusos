// ============================================================
//  i18n.ts — 中英双语
// ============================================================
//  设计取舍：**以中文原文作为词条键**。
//   · 好处：改造面最小 —— 组件里只需把字面量包一层 t('中文')，
//     漏翻时自动回落到中文原文，界面绝不会出现空白或 undefined。
//   · 代价：日后改中文文案等于改键名，需要同步改词典（已由
//     tests/i18n.test.ts 的完整性用例兜住）。
//  ⚠️ 本文件不得引入任何平台相关代码，渲染层与主进程都要能引用。
// ============================================================
import { EN } from './i18n.en'

export type Lang = 'zh' | 'en'

export const DEFAULT_LANG: Lang = 'zh'

/**
 * 语言清单。
 * 「语言」这类设置必须用**各自语言的原生写法**（endonym），
 * 否则一个只懂英文的用户切到中文界面后就再也找不到切回来的入口。
 */
export const LANGS: { id: Lang; native: string; hint: string }[] = [
  { id: 'zh', native: '简体中文', hint: 'Chinese (Simplified)' },
  { id: 'en', native: 'English', hint: 'English' }
]

export function isLang(v: unknown): v is Lang {
  return v === 'zh' || v === 'en'
}

/** `{name}` 形式的占位符插值 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  let out = template
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v))
  }
  return out
}

/**
 * 翻译。中文直接返回原文（词条键就是中文），英文查词典。
 * 词典缺失时回落原文 —— 永不返回空串。
 */
export function translate(
  zh: string,
  lang: Lang,
  vars?: Record<string, string | number>
): string {
  if (lang === 'zh') return interpolate(zh, vars)
  const hit = EN[zh]
  return interpolate(hit === undefined ? zh : hit, vars)
}

/** 词典里已收录的词条数（供测试与设置页展示覆盖率） */
export function dictionarySize(): number {
  return Object.keys(EN).length
}

// ============================================================
//  日历用的语言数据
// ============================================================
//  ⚠️ 星期与月份**不进词典**：它们是单字/缩写（'一'、'日'），
//     拿中文当键会和正文里的同名字符撞车（比如「一」既是星期一又是数字一）。
//     这里按语言给表，语义明确。
const WEEKDAY: Record<Lang, { short: string[]; long: string[] }> = {
  zh: {
    short: ['日', '一', '二', '三', '四', '五', '六'],
    long: ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  },
  en: {
    short: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    long: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  }
}

const MONTH: Record<Lang, { short: string[]; long: string[] }> = {
  zh: {
    short: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    long: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
  },
  en: {
    short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    long: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ]
  }
}

export function weekdayLabel(dow: number, lang: Lang, long = false): string {
  const i = ((dow % 7) + 7) % 7
  return long ? WEEKDAY[lang].long[i] : WEEKDAY[lang].short[i]
}

export function monthLabel(month0: number, lang: Lang, long = false): string {
  const i = ((month0 % 12) + 12) % 12
  return long ? MONTH[lang].long[i] : MONTH[lang].short[i]
}

/** 年 + 月的完整标题，各语言的语序不同，统一在这里拼 */
export function yearMonthLabel(year: number, month0: number, lang: Lang): string {
  return lang === 'zh'
    ? `${year} 年 ${month0 + 1} 月`
    : `${monthLabel(month0, lang, true)} ${year}`
}
