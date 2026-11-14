import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssistantStore } from '@renderer/store/assistant'
import { useSettingsStore } from '@renderer/store/settings'
import type {
  AiChatResult,
  AiChunk,
  AiProfile,
  AppSettings,
  ChatMessage,
  AgentRunInfo,
  RunLimits,
  RunUsage,
  SettingsPatch,
  ToolInfo,
  ToolResult
} from '@renderer/types'

const PROFILE_A: AiProfile = {
  id: 'a',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
  model: 'gpt-test'
}

const PROFILE_B: AiProfile = {
  id: 'b',
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
const chatWithTools =
  vi.fn<
    (
      requestId: string,
      messages: ChatMessage[],
      profileId: string,
      tools?: string[],
      runId?: string
    ) => Promise<AiChatResult>
  >()
const listTools = vi.fn<() => Promise<ToolInfo[]>>()
const executeTool = vi.fn<(name: string, input: unknown) => Promise<ToolResult>>()
const abortChat = vi.fn<(requestId: string) => void>()
const startRun = vi.fn<(limits?: RunLimits) => Promise<AgentRunInfo>>()
const finishRun = vi.fn<(id: string) => Promise<RunUsage>>()
const cancelRun = vi.fn<(id: string) => Promise<void>>()
let runSequence = 0
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
    chatWithTools,
    listTools,
    executeTool,
    abortChat,
    startRun,
    finishRun,
    cancelRun,
    onAiChunk
  } as unknown as Api
}

const readTool = (name: string): ToolInfo => ({
  name,
  title: name,
  description: name,
  inputSchema: { type: 'object', properties: {} },
  risk: 'read',
  exposeToAi: true
})

const replyResult = (text: string): AiChatResult => ({
  text,
  toolCalls: [],
  finishReason: 'stop'
})

// 让 pending 的 Promise 在几次微任务后继续
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
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

let resolveReply: (value: AiChatResult) => void
let rejectReply: (error: unknown) => void

/** 对话走带工具的 chatWithTools */
const pendingReply = (): void => {
  chatWithTools.mockImplementation(
    () =>
      new Promise<AiChatResult>((resolve, reject) => {
        resolveReply = resolve
        rejectReply = reject
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
    chatWithTools.mockReset()
    listTools.mockReset()
    executeTool.mockReset()
    abortChat.mockReset()
    startRun.mockReset()
    finishRun.mockReset()
    cancelRun.mockReset()
    onAiChunk.mockClear()
    runSequence = 0
    startRun.mockImplementation(async () => ({ id: `run-${(runSequence += 1)}` }))
    finishRun.mockResolvedValue({ steps: 1, inputTokens: 0, outputTokens: 0 })
    cancelRun.mockResolvedValue(undefined)
    listTools.mockResolvedValue([])
    executeTool.mockResolvedValue({ content: 'ok' })
    chunkHandler = null
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
    pendingReply()
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

    const [requestId, messages, profileId] = chatWithTools.mock.calls[0]
    expect(profileId).toBe('a')
    expect(messages[0].role).toBe('system')
    expect(messages).toHaveLength(21)
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'hello' })

    chunkHandler?.({ requestId, delta: '回复内容' })
    const reply = store.messages[store.messages.length - 1]
    expect(reply.content).toBe('回复内容')

    resolveReply(replyResult('回复内容'))
    await promise
    expect(reply.content).toBe('回复内容')
    expect(store.chatLoading).toBe(false)
  })

  it('runs read-only tools through the agent loop', async () => {
    listTools.mockResolvedValue([
      {
        name: 'library.list',
        title: '列出论文',
        description: '只读',
        inputSchema: { type: 'object', properties: {} },
        risk: 'read',
        exposeToAi: true
      },
      {
        name: 'annotations.remove',
        title: '删除标注',
        description: '破坏性',
        inputSchema: { type: 'object', properties: {} },
        risk: 'destructive',
        exposeToAi: true
      }
    ])
    chatWithTools
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'call-1', name: 'library.list', arguments: '{}' }],
        finishReason: 'tool_calls'
      })
      .mockResolvedValueOnce(replyResult('找到一篇论文'))
    executeTool.mockResolvedValue({ content: '{"total":1}' })

    const store = useAssistantStore()
    store.initialize()
    store.agentMode = true

    await store.sendChat('库里有几篇论文？')

    expect(listTools).toHaveBeenCalledTimes(1)
    expect(startRun).toHaveBeenCalledWith({ maxSteps: 6, timeoutMs: 120_000 })
    expect(chatWithTools.mock.calls[0][3]).toEqual(['library.list'])
    expect(chatWithTools.mock.calls[0][4]).toBe('run-1')
    expect(executeTool).toHaveBeenCalledWith('library.list', {})
    expect(finishRun).toHaveBeenCalledWith('run-1')
    expect(cancelRun).not.toHaveBeenCalled()
    expect(store.messages[store.messages.length - 1].content).toBe('找到一篇论文')
    expect(store.messages[store.messages.length - 1].toolNotes).toEqual(['调用工具：library.list'])
  })

  it('cancels the platform run when the agent is stopped', async () => {
    listTools.mockResolvedValue([readTool('library.list')])
    pendingReply()

    const store = useAssistantStore()
    store.initialize()
    store.agentMode = true

    const promise = store.sendChat('库里有几篇论文？')
    await flush()
    const requestId = chatWithTools.mock.calls[0][0]

    store.stopChat()

    expect(cancelRun).toHaveBeenCalledWith('run-1')
    expect(abortChat).toHaveBeenCalledWith(requestId)

    resolveReply(replyResult('部分内容'))
    await promise
    expect(finishRun).not.toHaveBeenCalled()
    expect(store.chatLoading).toBe(false)
  })

  it('stops a streaming chat reply', async () => {
    pendingReply()
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    const requestId = chatWithTools.mock.calls[0][0]
    chunkHandler?.({ requestId, delta: '部分' })

    store.stopChat()

    expect(abortChat).toHaveBeenCalledWith(requestId)
    expect(store.chatLoading).toBe(false)

    resolveReply(replyResult('部分内容'))
    await promise
    expect(store.chatLoading).toBe(false)
    expect(store.messages[store.messages.length - 1].content).toBe('部分')
  })

  it('shows an error when the request fails', async () => {
    pendingReply()
    const store = useAssistantStore()
    store.initialize()

    const promise = store.sendChat('hello')
    rejectReply(new Error("Error invoking remote method 'ai:chat': Error: 服务不可用"))
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
