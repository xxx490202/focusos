// ============================================================
//  i18n.ts — 渲染层的语言状态与 t()
// ============================================================
//  用法（组件内）：
//      const t = useT()
//      <button title={t('新建任务')}>{t('新建任务')}</button>
//      t('确定删除「{title}」吗？', { title })
//
//  ⭐ 之所以把语言放在 zustand 而不是 React Context：
//     组件用 useT() 订阅它，切语言时**所有用到 t 的组件自动重渲染**，
//     不需要在 App 里手工层层下发，也不会漏掉某个子树。
//
//  ⚠️ useT() 返回的函数每次渲染都是新引用（依赖 lang），
//     因此**不要**把它放进 useEffect/useMemo 的依赖数组，
//     否则每次渲染都会重新执行。传值用字符串即可。
// ============================================================
import { create } from 'zustand'
import { translate, isLang, type Lang } from '@shared/i18n'

export type { Lang }

export type TVars = Record<string, string | number>
export type TFn = (zh: string, vars?: TVars) => string

interface LangState {
  lang: Lang
  set: (l: Lang) => void
}

export const useI18n = create<LangState>((set) => ({
  lang: 'zh',
  set: (lang) => {
    // 同步 <html lang>，让浏览器/系统的字体回退与断词规则跟着走
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    }
    set({ lang })
  }
}))

/** 组件里取翻译函数；语言变化时自动重渲染 */
export function useT(): TFn {
  const lang = useI18n((s) => s.lang)
  return (zh, vars) => translate(zh, lang, vars)
}

/** 非组件环境（store / 事件回调 / 定时器）里取翻译 */
export function t(zh: string, vars?: TVars): string {
  return translate(zh, useI18n.getState().lang, vars)
}

/** 启动时按设置里的语言初始化一次 */
export function initLang(value: unknown): void {
  useI18n.getState().set(isLang(value) ? value : 'zh')
}

/** 当前语言（非响应式） */
export function currentLang(): Lang {
  return useI18n.getState().lang
}
