import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // ⚠️ 主进程只保留单一入口。
        //    拆成 index/window/tray/theme 四个入口会让 rollup 为每个入口
        //    重复打包 paths.ts 等共享模块，且 electron 的 external 引入
        //    在副产物里会失效（electron.app 变成 undefined）。
        //    window.ts / tray.ts / theme.ts 仍作为普通模块被 index.ts 引用。
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main')
      }
    }
  },
  preload: {
    /**
     * ⚠️ preload 必须**完全自包含**，不能把依赖留成 require('xxx')：
     *    · 渲染层开了 sandbox: true，preload 跑在沙箱 bundle 里，
     *      只认 electron 等少数内置模块，require('zod') 会直接抛
     *      「module not found: zod」→ window.api 变成 undefined → 全白屏。
     *    · 打包时 electron-builder 只收录 out/ 与 package.json，
     *      不会带 node_modules，即使没开沙箱也解析不到。
     *    因此这里把 zod 排除出 external，让它被打进 preload 产物。
     *    electron 本身仍保持 external（运行时由 Electron 注入）。
     */
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react()]
  }
})
