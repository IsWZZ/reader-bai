import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const rendererSrc = fileURLToPath(new URL('./src/renderer/src', import.meta.url))
const modulesSrc = fileURLToPath(new URL('./src/modules', import.meta.url))
const mainSrc = fileURLToPath(new URL('./src/main', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': rendererSrc,
      '@modules': modulesSrc,
      '@main': mainSrc,
      '@': rendererSrc
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'modules',
          include: ['src/modules/**/tests/**/*.test.ts']
        }
      }
    ],
    exclude: [
      'tests/e2e/**',
      'src/modules/**/tests/e2e/**',
      'node_modules/**',
      'out/**',
      'dist/**'
    ],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: [
        'src/renderer/src/**/*.{ts,vue}',
        'src/main/**/*.ts',
        'src/preload/**/*.ts',
        'src/modules/**/*.{ts,vue}'
      ],
      exclude: [
        'tests/**',
        'src/modules/**/tests/**',
        'src/renderer/src/components/ui/**',
        'src/renderer/src/main.ts',
        'src/renderer/src/types.ts',
        'src/renderer/src/env.d.ts'
      ]
    }
  }
})
