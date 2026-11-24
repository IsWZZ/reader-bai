import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const modulesDir = resolve('src/modules')
const mainDir = resolve('src/main')

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@main': mainDir,
        '@modules': modulesDir
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // 翻译宿主和扩展宿主都是独立 utilityProcess，必须各自产出入口
          'translation-host': resolve('src/modules/translation/main/host-process.ts'),
          'plugin-host': resolve('src/main/plugins/host-process.ts')
        }
      }
    }
  }, //主进程
  preload: {
    resolve: {
      alias: {
        '@modules': modulesDir
      }
    }
  }, //预加载
  //渲染进程
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@modules': modulesDir,
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [vue(), tailwindcss()]
  }
})
