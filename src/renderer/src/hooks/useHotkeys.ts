// ============================================================
//  useHotkeys.ts — 窗口内快捷键
// ============================================================
//  ⭐ 所有快捷键在 input/textarea 聚焦时失效（Esc 除外）
// ============================================================
import { useEffect } from 'react'
import { useUIStore } from '../stores/useUIStore'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUIStore.getState()

      // Esc 例外：任何时候都生效
      if (e.key === 'Escape') {
        if (ui.shortcutPanelOpen) {
          ui.setShortcutPanel(false)
          return
        }
        if (ui.taskModalOpen) {
          ui.closeTaskModal()
          return
        }
        // Esc 在全屏 / 小窗之间来回切换
        void window.api.window.action('toggle-fullscreen')
        return
      }

      if (isTyping(e.target)) return
      if (ui.taskModalOpen || ui.shortcutPanelOpen) return

      const mod = e.metaKey || e.ctrlKey

      // CmdOrCtrl+/ 唤出快捷键面板
      if (mod && e.key === '/') {
        e.preventDefault()
        ui.setShortcutPanel(!ui.shortcutPanelOpen)
        return
      }

      // 以下均为无修饰键的单键
      if (mod || e.altKey || e.shiftKey) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          void window.api.timer.get().then((r) => {
            if (!r.ok) return
            if (r.data.status === 'RUNNING') void window.api.timer.pause()
            else void window.api.timer.start()
          })
          break
        case 'r':
        case 'R':
          e.preventDefault()
          void window.api.timer.reset()
          break
        case 'b':
        case 'B':
          e.preventDefault()
          void window.api.timer.break()
          break
        case 's':
        case 'S':
          e.preventDefault()
          void window.api.timer.skip()
          break
        case 'f':
        case 'F':
          e.preventDefault()
          void window.api.window.action('toggle-fullscreen')
          break
        case 'n':
        case 'N':
          e.preventDefault()
          ui.openTaskModal()
          break
        case '/':
          e.preventDefault()
          ui.toggleSearch()
          break
        case 't':
        case 'T':
          e.preventDefault()
          void window.api.theme.get().then((r) => {
            if (!r.ok) return
            const next = r.data.effective === 'dark' ? 'light' : 'dark'
            void window.api.theme.set(next)
          })
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
