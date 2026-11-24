import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '@renderer/lib/i18n'
import { useSettingsStore } from '@renderer/store/settings'
import { useTranslationStore } from '../../renderer/store/translation'
import type { AiProfile, AppSettings, TranslationChunk, TranslationRequest } from '@renderer/types'

const PROFILE: AiProfile = {
  id: 'a',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
  model: 'gpt-test',
  enabled: true
}

const SETTINGS: AppSettings = {
  theme: 'light',
  language: 'zh',
  ai: { profiles: [PROFILE], activeId: 'a' },
  library: { directory: '', autoAnalyze: true },
  keyStorage: 'encrypted'
}

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn()
const activateTranslation = vi.fn<() => Promise<void>>()
const translate = vi.fn<(request: TranslationRequest) => Promise<string>>()
const abortTranslation = vi.fn<(requestId: string) => void>()
const unsubscribe = vi.fn()
let chunkHandler: ((payload: TranslationChunk) => void) | null = null
const onTranslationChunk = vi.fn((callback: (payload: TranslationChunk) => void) => {
  chunkHandler = callback
  return unsubscribe
})

const installApi = (): void => {
  window.api = {
    getSettings,
    updateSettings,
    activateTranslation,
    translate,
    abortTranslation,
    onTranslationChunk
  } as unknown as Api
}

const initializeSettings = async (settings: AppSettings = SETTINGS): Promise<void> => {
  getSettings.mockResolvedValue(structuredClone(settings))
  await useSettingsStore().initialize()
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

const noConfig = (): AppSettings => ({
  ...SETTINGS,
  ai: { profiles: [], activeId: '' }
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  getSettings.mockReset()
  updateSettings.mockReset()
  activateTranslation.mockReset()
  translate.mockReset()
  abortTranslation.mockReset()
  onTranslationChunk.mockClear()
  unsubscribe.mockClear()
  chunkHandler = null
  updateSettings.mockResolvedValue(structuredClone(SETTINGS))
  activateTranslation.mockResolvedValue(undefined)
  translate.mockResolvedValue('译文')
  installApi()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('translation store', () => {
  it('translates a selection after the debounce and streams the result', async () => {
    await initializeSettings()
    let resolveTranslation: (text: string) => void = () => undefined
    translate.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveTranslation = resolve
        })
    )

    const store = useTranslationStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('Hello world')
    expect(translate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)
    await flush()

    expect(activateTranslation).toHaveBeenCalledTimes(1)
    expect(translate).toHaveBeenCalledTimes(1)
    const request = translate.mock.calls[0][0]
    expect(request).toMatchObject({ source: 'Hello world', profileId: 'a' })
    expect(store.translation?.loading).toBe(true)

    chunkHandler?.({ requestId: request.requestId, delta: '你好' })
    expect(store.translation?.text).toBe('你好')

    resolveTranslation('你好世界')
    await flush()

    expect(store.translation).toEqual({
      source: 'Hello world',
      text: '你好世界',
      loading: false,
      error: ''
    })
  })

  it('aborts the previous translation when the selection changes', async () => {
    await initializeSettings()
    const requests: TranslationRequest[] = []
    translate.mockImplementation((request) => {
      requests.push(request)
      return new Promise<string>(() => undefined)
    })

    const store = useTranslationStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('first')
    await vi.advanceTimersByTimeAsync(250)
    await flush()
    const firstId = requests[0].requestId

    store.handleSelection('second')
    expect(abortTranslation).toHaveBeenCalledWith(firstId)

    await vi.advanceTimersByTimeAsync(250)
    await flush()
    const secondId = requests[1].requestId

    // 旧请求晚到不能覆盖新译文
    chunkHandler?.({ requestId: firstId, delta: '旧' })
    chunkHandler?.({ requestId: secondId, delta: '新' })
    expect(store.translation?.text).toBe('新')
  })

  it('ignores empty selections and repeats of the same text', async () => {
    await initializeSettings()
    const store = useTranslationStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('   ')
    await vi.advanceTimersByTimeAsync(250)
    expect(translate).not.toHaveBeenCalled()

    store.handleSelection('same')
    await vi.advanceTimersByTimeAsync(250)
    await flush()

    store.handleSelection('same')
    await vi.advanceTimersByTimeAsync(250)
    await flush()
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it('does not call the API without a complete configuration', async () => {
    await initializeSettings(noConfig())
    const store = useTranslationStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)
    await flush()

    expect(translate).not.toHaveBeenCalled()
    expect(store.translation?.error).toBe(t('translation.configHint'))
  })

  it('surfaces activation failures and allows a retry', async () => {
    await initializeSettings()
    activateTranslation.mockRejectedValueOnce(
      new Error("Error invoking remote method 'translation:activate': Error: boom")
    )

    const store = useTranslationStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)
    await flush()

    expect(translate).not.toHaveBeenCalled()
    expect(store.activationError).toContain('boom')
    expect(store.translation?.error).toContain('boom')

    activateTranslation.mockResolvedValueOnce(undefined)
    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)
    await flush()

    expect(translate).toHaveBeenCalledTimes(1)
    expect(store.activationError).toBe('')
  })

  it('activates the translation process only once', async () => {
    await initializeSettings()
    const store = useTranslationStore()

    await store.activate()
    await store.activate()

    expect(activateTranslation).toHaveBeenCalledTimes(1)
  })

  it('rejects selections that are too long', async () => {
    await initializeSettings()
    const store = useTranslationStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('x'.repeat(4001))
    await vi.advanceTimersByTimeAsync(250)

    expect(translate).not.toHaveBeenCalled()
    expect(store.translation?.error).toBe(t('translation.error.tooLong', { max: 4000 }))
  })

  it('clears the translation and pending selection when the paper changes', async () => {
    await initializeSettings()
    let requestId = ''
    translate.mockImplementation((request) => {
      requestId = request.requestId
      return new Promise<string>(() => undefined)
    })

    const store = useTranslationStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)
    await flush()

    store.resetTranslation()
    expect(abortTranslation).toHaveBeenCalledWith(requestId)
    expect(store.translation).toBeNull()

    store.setAutoTranslate(false)
    store.setAutoTranslate(true)
    await vi.advanceTimersByTimeAsync(250)
    await flush()

    expect(translate).toHaveBeenCalledTimes(1)
  })

  it('keeps the selection while the panel is closed and translates on open', async () => {
    await initializeSettings()
    const store = useTranslationStore()
    store.initialize()

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)
    await flush()
    expect(translate).not.toHaveBeenCalled()

    store.setAutoTranslate(true)
    await vi.advanceTimersByTimeAsync(250)
    await flush()
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it('degrades gracefully without window.api', async () => {
    await initializeSettings()
    window.api = undefined
    const store = useTranslationStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)
    await flush()

    expect(store.translation?.error).toBe(t('translation.error.environment'))
  })

  it('unsubscribes and aborts in-flight work on dispose', async () => {
    await initializeSettings()
    translate.mockImplementation(() => new Promise<string>(() => undefined))

    const store = useTranslationStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)
    await flush()
    const requestId = translate.mock.calls[0][0].requestId

    store.$dispose()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(abortTranslation).toHaveBeenCalledWith(requestId)
  })
})
