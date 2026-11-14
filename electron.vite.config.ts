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
          // 扩展宿主是独立 utilityProcess，必须单独产出一个入口
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
