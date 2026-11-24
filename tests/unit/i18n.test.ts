import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  availableLocales,
  DEFAULT_LOCALE,
  locale,
  normalizeLocale,
  setLocale,
  t
} from '@renderer/lib/i18n'

describe('i18n', () => {
  afterEach(() => {
    setLocale(DEFAULT_LOCALE)
  })

  it('registers the supported languages', () => {
    expect(availableLocales).toEqual([
      { code: 'zh', label: '中文' },
      { code: 'en', label: 'English' }
    ])
  })

  it('normalizes exact, base and unsupported language tags', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('EN')).toBe('en')
    expect(normalizeLocale(' en-US ')).toBe('en')
    expect(normalizeLocale('zh-Hans')).toBe('zh')
    expect(normalizeLocale('fr')).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale('')).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale(42)).toBe(DEFAULT_LOCALE)
  })

  it('defaults to Chinese messages', () => {
    expect(locale.value).toBe('zh')
    expect(t('settings.title')).toBe('设置')
  })

  it('switches messages and document language together', () => {
    expect(setLocale('en')).toBe('en')

    expect(locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(t('settings.title')).toBe('Settings')
    expect(t('settings.section.basic')).toBe('General')
  })

  it('falls back to the default locale for unknown tags', () => {
    setLocale('en')
    expect(setLocale('fr-CA')).toBe(DEFAULT_LOCALE)
    expect(locale.value).toBe('zh')
    expect(document.documentElement.lang).toBe('zh')
  })

  it('shares locale state when Vite evaluates the module twice (HMR)', async () => {
    // 开发模式下改了语言包或 i18n 依赖后，Vite HMR 会把模块图重新实例化，
    // 设置 store 的旧闭包和热更新后的组件可能各持一份 i18n 模块。
    // 两份必须共享同一个当前语言，否则会出现“活动栏切换了、设置页没切换”。
    vi.resetModules()
    const beforeHmr = await import('@renderer/lib/i18n')
    vi.resetModules()
    const afterHmr = await import('@renderer/lib/i18n')

    beforeHmr.setLocale('en')
    expect(afterHmr.locale.value).toBe('en')
    expect(afterHmr.t('settings.title')).toBe('Settings')

    afterHmr.setLocale('zh')
    expect(beforeHmr.locale.value).toBe('zh')
    expect(beforeHmr.t('settings.title')).toBe('设置')
  })

  it('interpolates placeholders and leaves unknown names intact', () => {
    setLocale('en')

    expect(t('library.importTo', { name: 'Papers' })).toContain('Papers')
    expect(t('translation.error.tooLong', { max: 4000 })).toContain('4000')
    // 参数缺失时保留占位符，避免显示 undefined
    expect(t('library.importTo')).toContain('{name}')
  })
})
