import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssistantStore } from '@renderer/store/assistant'
import { useSettingsStore } from '@renderer/store/settings'
import type { AiChunk, AiProfile, AppSettings, ChatMessage, SettingsPatch } from '@renderer/types'

const PROFILE_A: AiProfile = {
  id: 'a',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-test'
}

const PROFILE_B: AiProfile = {
  id: 'b',
  baseUrl: 'https://api2.example.com/v1',
  apiKey: 'sk-test-b',
  model: 'model-b'
}

const makeSettings = (settings: Omit<AppSettings, 'library'>): AppSettings => ({
  ...settings,
  library: { directory: '' }
})

const CONFIGURED = makeSettings({
  theme: 'light',
  ai: { profiles: [PROFILE_A], activeId: 'a' }
})

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn<(patch: SettingsPatch) => Promise<AppSettings>>()
const chat =
  vi.fn<(requestId: string, messages: ChatMessage[], profileId: string) => Promise<string>>()
const abortChat = vi.fn<(requestId: string) => void>()
let chunkHandler: ((payload: AiChunk) => void) | null = null
const unsubscribe = vi.fn()
const onAiChunk = vi.fn((callback: (payload: AiChunk) => void) => {
  chunkHandler = callback
  return unsubscribe
})

const installApi = (): void => {
  window.api = {
    getSettings,
    updateSettings,
    chat,
    abortChat,
    onAiChunk
  } as unknown as Api
}

// 让 pending 的 Promise 在几次微任务后继续
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

let resolveChat: (value: string) => void
let rejectChat: (error: unknown) => void

const pendingChat = (): void => {
  chat.mockImplementation(
    () =>
      new Promise<string>((resolve, reject) => {
        resolveChat = resolve
        rejectChat = reject
      })
  )
}

describe('assistant store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    getSettings.mockReset()
    updateSettings.mockReset()
    chat.mockReset()
    abortChat.mockReset()
    onAiChunk.mockClear()
    chunkHandler = null
    getSettings.mockResolvedValue(structuredClone(CONFIGURED))
    updateSettings.mockImplementation(async (patch) => ({
      theme: patch.theme ?? CONFIGURED.theme,
      ai: {
        profiles: patch.ai?.profiles ?? CONFIGURED.ai.profiles,
        activeId: patch.ai?.activeId ?? CONFIGURED.ai.activeId
      },
      library: { directory: '' }
    }))

    installApi()
    await useSettingsStore().initialize()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('translates a selection after the debounce', async () => {
    pendingChat()
    const store = useAssistantStore()
    store.initialize()

    store.handleSelection('Hello world')
    expect(chat).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)

    expect(chat).toHaveBeenCalledTimes(1)
    const [requestId, messages, profileId] = chat.mock.calls[0]
    expect(profileId).toBe('a')
    expect(messages[0].role).toBe('system')
    expect(messages[1]).toEqual({ role: 'user', content: 'Hello world' })
    expect(store.translation?.loading).toBe(true)

    chunkHandler?.({ requestId, delta: '你好' })
    expect(store.translation?.text).toBe('你好')

    resolveChat('你好世界')
    await flush()

    expect(store.translation).toEqual({
      source: 'Hello world',
      text: '你好世界',
      loading: false,
      error: ''
    })
  })

  it('aborts the previous translation when the selection changes', async () => {
    pendingChat()
    const store = useAssistantStore()
    store.initialize()

    store.handleSelection('first')
    await vi.advanceTimersByTimeAsync(250)
    const firstId = chat.mock.calls[0][0]

    store.handleSelection('second')
    expect(abortChat).toHaveBeenCalledWith(firstId)

    await vi.advanceTimersByTimeAsync(250)
    expect(chat).toHaveBeenCalledTimes(2)
    const secondId = chat.mock.calls[1][0]

    // 旧请求晚到不能覆盖新译文
    chunkHandler?.({ requestId: firstId, delta: '旧' })
    chunkHandler?.({ requestId: secondId, delta: '新' })
    expect(store.translation?.text).toBe('新')

    resolveChat('新译文')
    await flush()
    expect(store.translation?.text).toBe('新译文')
  })

  it('ignores empty selections and repeats of the same text', async () => {
    pendingChat()
    const store = useAssistantStore()
    store.initialize()

    store.handleSelection('   ')
    await vi.advanceTimersByTimeAsync(250)
    expect(chat).not.toHaveBeenCalled()

    store.handleSelection('same')
    await vi.advanceTimersByTimeAsync(250)
    resolveChat('译文')
    await flush()

    store.handleSelection('same')
    await vi.advanceTimersByTimeAsync(250)
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('does not call the API without a complete configuration', async () => {
    getSettings.mockResolvedValue(
      makeSettings({
        theme: 'light',
        ai: { profiles: [{ ...PROFILE_A, model: '' }], activeId: 'a' }
      })
    )
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const store = useAssistantStore()
    store.initialize()
    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).not.toHaveBeenCalled()
    expect(store.translation?.error).toContain('请先在设置')

    await store.sendChat('hello')
    expect(chat).not.toHaveBeenCalled()
    expect(store.chatError).toContain('请先在设置')
  })

  it('does not call the API when no profile is configured', async () => {
    getSettings.mockResolvedValue(
      makeSettings({ theme: 'light', ai: { profiles: [], activeId: '' } })
    )
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const store = useAssistantStore()
    store.initialize()

    await store.sendChat('hello')
    expect(chat).not.toHaveBeenCalled()
    expect(store.chatError).toContain('请先在设置')
  })

  it('uses the profile selected before the debounce fires', async () => {
    const settings = makeSettings({
      theme: 'light',
      ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'a' }
    })
    getSettings.mockResolvedValue(structuredClone(settings))
    updateSettings.mockImplementation(async (patch) => ({
      theme: patch.theme ?? settings.theme,
      ai: {
        profiles: patch.ai?.profiles ?? settings.ai.profiles,
        activeId: patch.ai?.activeId ?? settings.ai.activeId
      },
      library: settings.library
    }))
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    pendingChat()
    const store = useAssistantStore()
    store.initialize()

    await useSettingsStore().setActiveAiProfile('b')
    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).toHaveBeenCalledTimes(1)
    expect(chat.mock.calls[0][2]).toBe('b')
  })

  it('rejects an oversized selection without calling the API', async () => {
    const store = useAssistantStore()
    store.initialize()

    store.handleSelection('x'.repeat(4001))
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).not.toHaveBeenCalled()
    expect(store.translation?.error).toContain('选中的文本过长')
  })

  it('streams chat replies and only sends the recent history', async () => {
    pendingChat()
    const store = useAssistantStore()
    store.initialize()

    for (let i = 0; i < 25; i += 1) {
      store.messages.push({
        id: `old-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `m${i}`
      })
    }

    const promise = store.sendChat('hello')
    expect(store.messages).toHaveLength(27)
    expect(store.chatLoading).toBe(true)

    const [requestId, messages, profileId] = chat.mock.calls[0]
    expect(profileId).toBe('a')
    expect(messages[0].role).toBe('system')
    expect(messages).toHaveLength(21)
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'hello' })

    chunkHandler?.({ requestId, delta: '回复' })
    const reply = store.messages[store.messages.length - 1]
    expect(reply.content).toBe('回复')

    resolveChat('回复内容')
    await promise
    expect(reply.content).toBe('回复内容')
    expect(store.chatLoading).toBe(false)
  })

  it('stops a streaming chat reply', async () => {
    pendingChat()
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    const requestId = chat.mock.calls[0][0]
    chunkHandler?.({ requestId, delta: '部分' })

    store.stopChat()

    expect(abortChat).toHaveBeenCalledWith(requestId)
    expect(store.chatLoading).toBe(false)

    resolveChat('部分内容')
    await promise
    expect(store.chatLoading).toBe(false)
    expect(store.messages[store.messages.length - 1].content).toBe('部分')
  })

  it('shows an error when the request fails', async () => {
    pendingChat()
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    rejectChat(new Error("Error invoking remote method 'ai:chat': Error: 服务不可用"))
    await promise

    expect(store.chatError).toBe('服务不可用')
    expect(store.chatLoading).toBe(false)
  })

  it('clears the translation when the paper changes', async () => {
    pendingChat()
    const store = useAssistantStore()
    store.initialize()

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)
    const requestId = chat.mock.calls[0][0]

    store.resetTranslation()

    expect(abortChat).toHaveBeenCalledWith(requestId)
    expect(store.translation).toBeNull()
  })

  it('unsubscribes from chunks when disposed', async () => {
    const store = useAssistantStore()
    store.initialize()

    expect(onAiChunk).toHaveBeenCalledTimes(1)

    store.$dispose()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
