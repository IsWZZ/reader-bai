import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const rendererSrc = fileURLToPath(new URL('./src/renderer/src', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': rendererSrc,
      '@': rendererSrc
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'out/**', 'dist/**'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/renderer/src/**/*.{ts,vue}', 'src/main/**/*.ts', 'src/preload/**/*.ts'],
      exclude: [
        'tests/**',
        'src/renderer/src/components/ui/**',
        'src/renderer/src/main.ts',
        'src/renderer/src/types.ts',
        'src/renderer/src/env.d.ts'
      ]
    }
  }
})
