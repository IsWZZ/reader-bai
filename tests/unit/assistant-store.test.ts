import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssistantStore } from '@renderer/store/assistant'
import { useSettingsStore } from '@renderer/store/settings'
import type {
  AgentEvent,
  AgentEventPayload,
  AgentSessionInfo,
  AgentStartRequest,
  AiChunk,
  AiProfile,
  AppSettings,
  ChatMessage,
  SettingsPatch
} from '@renderer/types'

const PROFILE_A: AiProfile = {
  id: 'a',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
  model: 'gpt-test'
}

const PROFILE_B: AiProfile = {
  id: 'b',
  provider: 'openai',
  baseUrl: 'https://api2.example.com/v1',
  hasApiKey: true,
  model: 'model-b'
}

const makeSettings = (
  settings: Omit<AppSettings, 'library' | 'keyStorage' | 'language'>,
  language = 'zh'
): AppSettings => ({
  ...settings,
  language,
  library: { directory: '' },
  keyStorage: 'encrypted'
})

const CONFIGURED = makeSettings({
  theme: 'light',
  ai: { profiles: [PROFILE_A], activeId: 'a' }
})

/** 模拟主进程：补丁里没有 Key 的配置沿用原来的 hasApiKey */
const toPublicProfiles = (patch: SettingsPatch | undefined, base: AiProfile[]): AiProfile[] => {
  if (!patch?.ai?.profiles) return base.map((profile) => ({ ...profile }))
  return patch.ai.profiles.map((profile) => {
    const existing = base.find((item) => item.id === profile.id)
    return {
      id: profile.id,
      provider: profile.provider ?? existing?.provider ?? 'openai',
      baseUrl: profile.baseUrl,
      model: profile.model,
      hasApiKey: Boolean(profile.apiKey) || Boolean(existing?.hasApiKey)
    }
  })
}

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn<(patch: SettingsPatch) => Promise<AppSettings>>()
const chat =
  vi.fn<(requestId: string, messages: ChatMessage[], profileId: string) => Promise<string>>()
const abortChat = vi.fn<(requestId: string) => void>()
const startAgent = vi.fn<(request: AgentStartRequest) => Promise<AgentSessionInfo>>()
const cancelAgent = vi.fn<(id: string) => Promise<void>>()
let runSequence = 0

let chunkHandler: ((payload: AiChunk) => void) | null = null
let agentHandler: ((payload: AgentEventPayload) => void) | null = null
const unsubscribeChunks = vi.fn()
const unsubscribeAgent = vi.fn()
const onAiChunk = vi.fn((callback: (payload: AiChunk) => void) => {
  chunkHandler = callback
  return unsubscribeChunks
})
const onAgentEvent = vi.fn((callback: (payload: AgentEventPayload) => void) => {
  agentHandler = callback
  return unsubscribeAgent
})

const installApi = (): void => {
  window.api = {
    getSettings,
    updateSettings,
    chat,
    abortChat,
    startAgent,
    cancelAgent,
    onAiChunk,
    onAgentEvent
  } as unknown as Api
}

const replyResult = (text: string): AgentEvent => ({
  type: 'done',
  text,
  steps: 1,
  finishReason: 'stop'
})

// 让 pending 的 Promise 在几次微任务后继续
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

const emitAgent = (sessionId: string, event: AgentEvent): void => {
  agentHandler?.({ sessionId, event })
}

let resolveChat: (value: string) => void

/** 翻译仍走只返回文本的 chat */
const pendingChat = (): void => {
  chat.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveChat = resolve
      })
  )
}

let resolveSession: (value: AgentSessionInfo) => void

/** 会话 id 迟迟不返回，用于测试“启动途中停止” */
const pendingSession = (): void => {
  startAgent.mockImplementation(
    () =>
      new Promise<AgentSessionInfo>((resolve) => {
        resolveSession = resolve
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
    startAgent.mockReset()
    cancelAgent.mockReset()
    onAiChunk.mockClear()
    onAgentEvent.mockClear()
    unsubscribeChunks.mockClear()
    unsubscribeAgent.mockClear()
    runSequence = 0
    startAgent.mockImplementation(async () => ({ id: `session-${(runSequence += 1)}` }))
    cancelAgent.mockResolvedValue(undefined)
    chunkHandler = null
    agentHandler = null
    getSettings.mockResolvedValue(structuredClone(CONFIGURED))
    updateSettings.mockImplementation(async (patch) => ({
      theme: patch.theme ?? CONFIGURED.theme,
      language: patch.language ?? CONFIGURED.language,
      ai: {
        profiles: toPublicProfiles(patch, CONFIGURED.ai.profiles),
        activeId: patch.ai?.activeId ?? CONFIGURED.ai.activeId
      },
      library: { directory: '' },
      keyStorage: CONFIGURED.keyStorage
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
    store.setAutoTranslate(true)

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
    store.setAutoTranslate(true)

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
    store.setAutoTranslate(true)

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
    store.setAutoTranslate(true)
    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).not.toHaveBeenCalled()
    expect(store.translation?.error).toContain('请先在设置')

    await store.sendChat('hello')
    expect(chat).not.toHaveBeenCalled()
    expect(startAgent).not.toHaveBeenCalled()
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
    expect(startAgent).not.toHaveBeenCalled()
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
      language: patch.language ?? settings.language,
      ai: {
        profiles: toPublicProfiles(patch, settings.ai.profiles),
        activeId: patch.ai?.activeId ?? settings.ai.activeId
      },
      library: settings.library,
      keyStorage: settings.keyStorage
    }))
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    pendingChat()
    const store = useAssistantStore()
    store.initialize()
    store.setAutoTranslate(true)

    await useSettingsStore().setActiveAiProfile('b')
    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).toHaveBeenCalledTimes(1)
    expect(chat.mock.calls[0][2]).toBe('b')
  })

  it('shows a translation error and allows retrying the same text', async () => {
    chat.mockRejectedValueOnce(
      new Error("Error invoking remote method 'ai:chat': Error: 翻译服务不可用")
    )
    const store = useAssistantStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)

    expect(store.translation).toEqual({
      source: 'hello',
      text: '',
      loading: false,
      error: '翻译服务不可用'
    })

    pendingChat()
    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).toHaveBeenCalledTimes(2)
    resolveChat('你好')
    await flush()
    expect(store.translation).toMatchObject({ text: '你好', error: '' })
  })

  it('uses the fallback message for non-Error translation failures', async () => {
    chat.mockRejectedValueOnce('offline')
    const store = useAssistantStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)

    expect(store.translation?.error).toBe('翻译失败，请稍后重试')
  })

  it('reports a missing platform bridge', async () => {
    window.api = undefined
    const store = useAssistantStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)

    expect(store.translation?.error).toBe('当前环境无法调用 AI 服务')

    await store.sendChat('hello')
    expect(store.chatError).toBe('当前环境无法调用 AI 服务')
    expect(store.messages).toHaveLength(0)
  })

  it('rejects an oversized selection without calling the API', async () => {
    const store = useAssistantStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('x'.repeat(4001))
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).not.toHaveBeenCalled()
    expect(store.translation?.error).toContain('选中的文本过长')
  })

  it('does not translate a selection while the panel is closed', async () => {
    const store = useAssistantStore()
    store.initialize()

    store.handleSelection('Hello world')
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).not.toHaveBeenCalled()
    expect(store.translation).toBeNull()
  })

  it('translates only the latest selection when the panel opens', async () => {
    pendingChat()
    const store = useAssistantStore()
    store.initialize()

    store.handleSelection('first')
    store.handleSelection('Hello world')
    await vi.advanceTimersByTimeAsync(250)
    expect(chat).not.toHaveBeenCalled()

    store.setAutoTranslate(true)
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).toHaveBeenCalledTimes(1)
    expect(chat.mock.calls[0][1][1]).toEqual({ role: 'user', content: 'Hello world' })
  })

  it('does not repeat the remembered selection when the panel reopens', async () => {
    pendingChat()
    const store = useAssistantStore()
    store.initialize()
    store.setAutoTranslate(true)

    store.handleSelection('hello')
    await vi.advanceTimersByTimeAsync(250)
    resolveChat('你好')
    await flush()

    store.setAutoTranslate(false)
    store.setAutoTranslate(true)
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('drops the remembered selection when the paper changes', async () => {
    const store = useAssistantStore()
    store.initialize()

    store.handleSelection('hello')
    store.resetTranslation()
    store.setAutoTranslate(true)
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).not.toHaveBeenCalled()
    expect(store.translation).toBeNull()
  })

  it('starts an agent session with recent history and streams its events', async () => {
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

    await flush()

    const [request] = startAgent.mock.calls[0]
    expect(request.profileId).toBe('a')
    expect(request.mode).toBe('chat')
    expect(request.messages).toHaveLength(20)
    expect(request.messages[0]).toEqual({ role: 'user', content: 'm6' })
    expect(request.messages[request.messages.length - 1]).toEqual({
      role: 'user',
      content: 'hello'
    })

    emitAgent('session-1', { type: 'chunk', delta: '回复内容' })
    const reply = store.messages[store.messages.length - 1]
    expect(reply.content).toBe('回复内容')

    emitAgent('session-1', replyResult('回复内容'))
    await promise
    expect(reply.content).toBe('回复内容')
    expect(store.chatLoading).toBe(false)
  })

  it('uses the final text when no stream chunks arrive', async () => {
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    await flush()
    emitAgent('session-1', replyResult('最终回复'))
    await promise

    expect(store.messages).toHaveLength(2)
    expect(store.messages[1]).toMatchObject({ role: 'assistant', content: '最终回复' })
    expect(store.chatLoading).toBe(false)
  })

  it('buffers events that arrive before the session id is known', async () => {
    pendingSession()
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    await flush()

    emitAgent('session-1', { type: 'chunk', delta: '早到' })
    emitAgent('session-1', replyResult('早到'))

    resolveSession({ id: 'session-1' })
    await promise

    expect(store.messages[1].content).toBe('早到')
    expect(store.chatLoading).toBe(false)
  })

  it('ignores events from other sessions', async () => {
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    await flush()

    emitAgent('session-other', { type: 'chunk', delta: '串台' })
    expect(store.messages[1].content).toBe('')

    emitAgent('session-1', replyResult('正常'))
    await promise
    expect(store.messages[1].content).toBe('正常')
  })

  it('ignores blank input and concurrent submissions', async () => {
    const store = useAssistantStore()
    store.initialize()

    await store.sendChat('   ')
    expect(store.messages).toHaveLength(0)

    const first = store.sendChat('hello')
    await store.sendChat('again')

    expect(startAgent).toHaveBeenCalledTimes(1)
    expect(store.messages.map((entry) => entry.content)).toEqual(['hello', ''])

    await flush()
    emitAgent('session-1', replyResult('ok'))
    await first
  })

  it('passes agent mode to the platform and shows tool notes', async () => {
    const store = useAssistantStore()
    store.initialize()
    store.agentMode = true

    const promise = store.sendChat('库里有几篇论文？')
    await flush()

    expect(startAgent.mock.calls[0][0].mode).toBe('agent')

    emitAgent('session-1', { type: 'chunk', delta: '查询中' })
    emitAgent('session-1', { type: 'tool-call', callId: 'call-1', name: 'library.list' })
    emitAgent('session-1', {
      type: 'tool-result',
      callId: 'call-1',
      name: 'library.list',
      content: '{"total":1}'
    })
    emitAgent('session-1', {
      type: 'tool-error',
      callId: 'call-2',
      name: 'paper.get',
      error: '缺少参数'
    })
    emitAgent('session-1', replyResult('找到一篇论文'))
    await promise

    const reply = store.messages[store.messages.length - 1]
    expect(reply.content).toBe('查询中')
    expect(reply.toolNotes).toEqual(['调用工具：library.list', '工具 paper.get 失败：缺少参数'])
  })

  it('cancels the session when stopped', async () => {
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    await flush()
    emitAgent('session-1', { type: 'chunk', delta: '部分' })

    store.stopChat()
    expect(cancelAgent).toHaveBeenCalledWith('session-1')
    expect(store.chatLoading).toBe(false)

    await promise
    expect(store.messages[store.messages.length - 1].content).toBe('部分')
  })

  it('cancels a session that starts after the user stops', async () => {
    pendingSession()
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    await flush()
    store.stopChat()

    resolveSession({ id: 'session-9' })
    await promise

    expect(cancelAgent).toHaveBeenCalledWith('session-9')
    expect(store.chatLoading).toBe(false)
  })

  it('shows an error emitted by the agent', async () => {
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    await flush()
    emitAgent('session-1', { type: 'error', message: '服务不可用' })
    await promise

    expect(store.chatError).toBe('服务不可用')
    expect(store.chatLoading).toBe(false)
    // 失败的空白回复要移除，只保留用户消息
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]).toMatchObject({ role: 'user', content: 'hello' })
  })

  it('shows an error when the session cannot start', async () => {
    startAgent.mockRejectedValueOnce(
      new Error("Error invoking remote method 'agent:start': Error: 无法启动 agent 宿主")
    )
    const store = useAssistantStore()
    store.initialize()

    await store.sendChat('hello')

    expect(store.chatError).toBe('无法启动 agent 宿主')
    expect(store.chatLoading).toBe(false)
    expect(store.messages).toHaveLength(1)
  })

  it('cancels the session and unsubscribes when disposed', async () => {
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    await flush()

    store.$dispose()

    expect(cancelAgent).toHaveBeenCalledWith('session-1')
    expect(unsubscribeChunks).toHaveBeenCalled()
    expect(unsubscribeAgent).toHaveBeenCalled()

    await promise
  })

  it('clears the translation when the paper changes', async () => {
    pendingChat()
    const store = useAssistantStore()
    store.initialize()
    store.setAutoTranslate(true)

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
    expect(onAgentEvent).toHaveBeenCalledTimes(1)

    store.$dispose()

    expect(unsubscribeChunks).toHaveBeenCalled()
    expect(unsubscribeAgent).toHaveBeenCalled()
  })
})
