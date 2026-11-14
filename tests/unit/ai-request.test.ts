import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiRequester, resolveChatTools, type AiChatRequest } from '../../src/main/ai-request'
import { streamChat, type StreamChatResult } from '../../src/main/ai'
import { createRunManager } from '../../src/main/ai-run'
import { createToolRegistry, type ToolRegistry } from '../../src/main/tool-registry'
import type { StoredSettings } from '../../src/main/settings'
import type { SettingsStore } from '../../src/main/settings-store'

vi.mock('../../src/main/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/ai')>()
  return { ...actual, streamChat: vi.fn() }
})

const streamChatMock = vi.mocked(streamChat)

const okResult = (text = '你好'): StreamChatResult => ({
  text,
  toolCalls: [],
  finishReason: 'stop'
})

const PROFILE = {
  id: 'profile-1',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'encrypted-key',
  apiKeyEncrypted: true,
  model: 'test-model'
}

const storedSettings = (profiles = [PROFILE]): StoredSettings => ({
  theme: 'light',
  language: 'zh',
  ai: { profiles, activeId: profiles[0]?.id ?? '' },
  library: { directory: '' }
})

const makeSettings = (profiles = [PROFILE], decodedKey = 'sk-secret'): SettingsStore => {
  const read = vi.fn(async () => storedSettings(profiles))
  const decodeApiKey = vi.fn(() => decodedKey)
  return { read, decodeApiKey } as unknown as SettingsStore
}

const makeTools = (): ToolRegistry => {
  const registry = createToolRegistry()
  registry.register({
    name: 'library.list',
    title: '列出论文',
    description: '列出论文库中的论文',
    inputSchema: { type: 'object', properties: {} },
    risk: 'read',
    exposeToAi: true,
    execute: async () => ({ content: '{"total":0}' })
  })
  registry.register({
    name: 'annotations.add',
    title: '添加标注',
    description: '写入标注',
    inputSchema: { type: 'object', properties: {} },
    risk: 'write',
    exposeToAi: false,
    execute: async () => ({ content: 'ok' })
  })
  return registry
}

const baseRequest = (): AiChatRequest => ({
  requestId: 'req-1',
  messages: [{ role: 'user', content: 'hi' }],
  profileId: 'profile-1',
  onDelta: vi.fn()
})

/** 让 `chat` 走到 streamChat（中途有 await settings.read） */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('resolveChatTools', () => {
  it('returns no tools when nothing is requested', () => {
    expect(resolveChatTools(undefined, makeTools())).toEqual([])
    expect(resolveChatTools(null, makeTools())).toEqual([])
  })

  it('rejects malformed tool lists', () => {
    const tools = makeTools()
    expect(() => resolveChatTools('library.list', tools)).toThrow('工具列表不正确')
    expect(() =>
      resolveChatTools(
        Array.from({ length: 51 }, () => 'library.list'),
        tools
      )
    ).toThrow('工具数量不能超过 50 个')
    expect(() => resolveChatTools([''], tools)).toThrow('工具名称不正确')
    expect(() => resolveChatTools([42], tools)).toThrow('工具名称不正确')
    expect(() => resolveChatTools(['x'.repeat(101)], tools)).toThrow('工具名称不正确')
  })

  it('only exposes registered tools that are open to AI', () => {
    const tools = makeTools()
    expect(() => resolveChatTools(['missing.tool'], tools)).toThrow(
      '工具不存在或未对 AI 开放：missing.tool'
    )
    expect(() => resolveChatTools(['annotations.add'], tools)).toThrow(
      '工具不存在或未对 AI 开放：annotations.add'
    )
  })

  it('dedupes names and keeps registry-provided schemas', () => {
    const definitions = resolveChatTools([' library.list ', 'library.list'], makeTools())

    expect(definitions).toEqual([
      {
        type: 'function',
        function: {
          name: 'library.list',
          description: '列出论文库中的论文',
          parameters: { type: 'object', properties: {} }
        }
      }
    ])
  })
})

describe('createAiRequester', () => {
  beforeEach(() => {
    streamChatMock.mockReset()
    streamChatMock.mockResolvedValue(okResult())
  })

  it('resolves the profile, decrypts the key and streams the reply', async () => {
    const settings = makeSettings()
    const request = baseRequest()
    const requester = createAiRequester(settings, makeTools())

    const result = await requester.chat({ ...request, toolNames: ['library.list'] })

    expect(result).toEqual(okResult())
    expect(settings.read).toHaveBeenCalledTimes(1)
    expect(settings.decodeApiKey).toHaveBeenCalledWith(PROFILE)
    const options = streamChatMock.mock.calls[0][0]
    expect(options).toMatchObject({
      baseUrl: PROFILE.baseUrl,
      apiKey: 'sk-secret',
      model: PROFILE.model,
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(options.tools?.[0]?.function.name).toBe('library.list')
    expect(options.signal.aborted).toBe(false)

    options.onDelta('你')
    expect(request.onDelta).toHaveBeenCalledWith('你')
  })

  it('normalizes messages before calling the model', async () => {
    const requester = createAiRequester(makeSettings(), makeTools())

    await requester.chat({
      ...baseRequest(),
      messages: [{ role: 'user', content: 'hi', extra: true }]
    })

    expect(streamChatMock.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('rejects invalid request and profile identifiers', async () => {
    const requester = createAiRequester(makeSettings(), makeTools())

    await expect(requester.chat({ ...baseRequest(), requestId: '' })).rejects.toThrow(
      '请求标识不正确'
    )
    await expect(requester.chat({ ...baseRequest(), requestId: 'x'.repeat(101) })).rejects.toThrow(
      '请求标识不正确'
    )
    await expect(
      requester.chat({ ...baseRequest(), requestId: 42 as unknown as string })
    ).rejects.toThrow('请求标识不正确')
    await expect(requester.chat({ ...baseRequest(), profileId: '' })).rejects.toThrow(
      '请先在设置中选择 AI 服务'
    )
    expect(streamChatMock).not.toHaveBeenCalled()
  })

  it('rejects unknown or incomplete profiles and insecure base URLs', async () => {
    const missingProfile = createAiRequester(makeSettings([]), makeTools())
    await expect(missingProfile.chat(baseRequest())).rejects.toThrow(
      '所选 AI 配置不存在，请重新选择'
    )

    const incomplete = createAiRequester(makeSettings([{ ...PROFILE, model: '' }]), makeTools())
    await expect(incomplete.chat(baseRequest())).rejects.toThrow(
      '请先补全所选 AI 服务的 Base URL、API Key 和模型'
    )

    const insecure = createAiRequester(
      makeSettings([{ ...PROFILE, baseUrl: 'http://api.example.com/v1' }]),
      makeTools()
    )
    await expect(insecure.chat(baseRequest())).rejects.toThrow('Base URL')
    expect(streamChatMock).not.toHaveBeenCalled()
  })

  it('distinguishes a failed key decryption from a missing key', async () => {
    const encrypted = createAiRequester(makeSettings([PROFILE], ''), makeTools())
    await expect(encrypted.chat(baseRequest())).rejects.toThrow('API Key 解密失败')

    const plain = createAiRequester(
      makeSettings([{ ...PROFILE, apiKey: '', apiKeyEncrypted: false }], ''),
      makeTools()
    )
    await expect(plain.chat(baseRequest())).rejects.toThrow(
      '请先补全所选 AI 服务的 Base URL、API Key 和模型'
    )
    expect(streamChatMock).not.toHaveBeenCalled()
  })

  it('rejects a duplicate request id while the first is in flight', async () => {
    let finish: (result: StreamChatResult) => void = () => undefined
    streamChatMock.mockImplementation(
      () =>
        new Promise<StreamChatResult>((resolve) => {
          finish = resolve
        })
    )
    const requester = createAiRequester(makeSettings(), makeTools())

    const first = requester.chat(baseRequest())
    await expect(requester.chat(baseRequest())).rejects.toThrow('请求标识重复')

    finish(okResult())
    await expect(first).resolves.toEqual(okResult())

    // 完成后同一个 id 可以再次使用
    streamChatMock.mockResolvedValue(okResult('再次'))
    await expect(requester.chat(baseRequest())).resolves.toEqual(okResult('再次'))
  })

  it('does not call the model when the run is already aborted', async () => {
    const runs = createRunManager()
    const run = runs.start()
    run.cancel('user')
    const requester = createAiRequester(makeSettings(), makeTools())

    await expect(requester.chat({ ...baseRequest(), run })).rejects.toThrow('运行已取消')
    expect(streamChatMock).not.toHaveBeenCalled()
  })

  it('records a step per model call and stops after the run budget', async () => {
    const runs = createRunManager()
    const run = runs.start({ maxSteps: 1 })
    const requester = createAiRequester(makeSettings(), makeTools())

    await requester.chat({ ...baseRequest(), run })
    expect(run.usage.steps).toBe(1)

    await expect(requester.chat({ ...baseRequest(), requestId: 'req-2', run })).rejects.toThrow(
      '已达到最大步数（1）'
    )
    expect(run.abortReason).toBe('limit')
    expect(streamChatMock).toHaveBeenCalledTimes(1)
  })

  it('aborts an in-flight request by id', async () => {
    let finish: (result: StreamChatResult) => void = () => undefined
    streamChatMock.mockImplementation(
      () =>
        new Promise<StreamChatResult>((resolve) => {
          finish = resolve
        })
    )
    const requester = createAiRequester(makeSettings(), makeTools())

    const pending = requester.chat(baseRequest())
    await flush()
    const signal = streamChatMock.mock.calls[0][0].signal
    expect(signal.aborted).toBe(false)

    requester.abort('req-1')
    expect(signal.aborted).toBe(true)

    finish(okResult())
    await pending

    // 结束后再中止是幂等的
    expect(() => requester.abort('req-1')).not.toThrow()
  })

  it('makes no-op abort calls for unknown request ids', () => {
    const requester = createAiRequester(makeSettings(), makeTools())
    expect(() => requester.abort('missing')).not.toThrow()
  })

  it('bridges the run signal and the caller signal into the request', async () => {
    const signals: AbortSignal[] = []
    streamChatMock.mockImplementation((options) => {
      signals.push(options.signal)
      return new Promise<StreamChatResult>(() => undefined)
    })
    const runs = createRunManager()
    const run = runs.start()
    const controller = new AbortController()
    const requester = createAiRequester(makeSettings(), makeTools())

    void requester.chat({ ...baseRequest(), run, signal: controller.signal })
    await flush()
    expect(signals[0].aborted).toBe(false)

    run.cancel('user')
    expect(signals[0].aborted).toBe(true)

    const callerController = new AbortController()
    void requester.chat({
      ...baseRequest(),
      requestId: 'req-2',
      signal: callerController.signal
    })
    await flush()
    expect(signals[1].aborted).toBe(false)

    callerController.abort()
    expect(signals[1].aborted).toBe(true)
  })

  it('aborts immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const requester = createAiRequester(makeSettings(), makeTools())

    void requester.chat({ ...baseRequest(), signal: controller.signal })
    await flush()

    expect(streamChatMock.mock.calls[0][0].signal.aborted).toBe(true)
  })
})
