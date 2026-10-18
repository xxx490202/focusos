// ============================================================
//  main.tsx — 渲染层入口
// ============================================================
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'
import './styles/themes.css'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 容器')

/*
 * 关掉 Chromium 的默认右键菜单。
 * ⚠️ 它是浏览器语义的（重新加载、检查元素…），出现在桌面应用里非常出戏，
 *    而且会和我们的右键菜单叠在一起。
 *    输入框例外 —— 那里需要系统的「粘贴 / 全选」。
 */
document.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement | null
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
  e.preventDefault()
})

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
