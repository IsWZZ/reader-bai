import { describe, expect, it } from 'vitest'
import { buildTranslationMessages, TRANSLATION_SYSTEM_PROMPT } from '../../main/prompt'

describe('buildTranslationMessages', () => {
  it('builds a system prompt followed by the selected text', () => {
    const messages = buildTranslationMessages('Hello world')

    expect(messages).toEqual([
      { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
      { role: 'user', content: 'Hello world' }
    ])
    expect(TRANSLATION_SYSTEM_PROMPT).toContain('翻译')
  })

  it('keeps the source text unchanged', () => {
    const source = '  line one\nline two  '
    expect(buildTranslationMessages(source)[1]).toEqual({ role: 'user', content: source })
  })
})
