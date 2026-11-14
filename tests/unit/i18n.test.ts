import { afterEach, describe, expect, it } from 'vitest'
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

  it('interpolates placeholders and leaves unknown names intact', () => {
    setLocale('en')

    expect(t('library.importTo', { name: 'Papers' })).toContain('Papers')
    expect(t('assistant.error.tooLong', { max: 4000 })).toContain('4000')
    // 参数缺失时保留占位符，避免显示 undefined
    expect(t('library.importTo')).toContain('{name}')
  })
})
