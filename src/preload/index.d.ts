// ============================================================
//  env.d.ts — window.api 类型注入
// ============================================================
import type { FocusOsApi } from '../preload/index'

declare global {
  interface Window {
    api: FocusOsApi
  }
}

export {}
