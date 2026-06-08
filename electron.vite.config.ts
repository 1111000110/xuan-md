import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    server: {
      fs: { allow: [resolve('.')] }
    },
    build: {
      rollupOptions: {
        input: {
          // 主编辑器窗口
          index: resolve('src/renderer/index.html'),
          // 速记面板窗口（全局快捷键唤起、失焦隐藏、列表首页）
          quick: resolve('src/renderer/quick.html')
        }
      }
    }
  }
})
