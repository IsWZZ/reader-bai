import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // agent 宿主和扩展宿主都是独立 utilityProcess，必须各自产出入口
          'agent-host': resolve('src/main/agent/host-process.ts'),
          'plugin-host': resolve('src/main/plugins/host-process.ts')
        }
      }
    }
  }, //主进程
  preload: {}, //预加载
  //渲染进程
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [vue(), tailwindcss()]
  }
})
