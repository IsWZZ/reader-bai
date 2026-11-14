import { describe, expect, it } from 'vitest'
import { aiProfileLabel } from '@renderer/lib/ai'
import { t } from '@renderer/lib/i18n'
import type { AiProfile } from '@renderer/types'

const profile = (overrides: Partial<AiProfile> = {}): AiProfile => ({
  id: 'p1',
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-test',
  hasApiKey: true,
  ...overrides
})

describe('aiProfileLabel', () => {
  it('combines the model name with the host to tell same-named models apart', () => {
    expect(aiProfileLabel(profile())).toBe('gpt-test · api.example.com')
  })

  it('keeps the model name when the base URL cannot be parsed', () => {
    expect(aiProfileLabel(profile({ baseUrl: 'not a url' }))).toBe('gpt-test')
  })

  it('keeps the model name when the URL has no host', () => {
    expect(aiProfileLabel(profile({ baseUrl: 'mailto:someone@example.com' }))).toBe('gpt-test')
  })

  it('falls back to the base URL when the model is missing', () => {
    expect(aiProfileLabel(profile({ model: '' }))).toBe('https://api.example.com/v1')
  })

  it('falls back to the untitled label when nothing is configured', () => {
    expect(aiProfileLabel(profile({ model: '', baseUrl: '' }))).toBe(t('common.untitledProfile'))
  })
})
