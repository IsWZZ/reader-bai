import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiRequester, type AiChatRequest } from '../../src/main/ai-request'
import { streamChat, type StreamChatResult } from '../../src/main/ai'
import { streamAnthropic } from '../../src/main/ai-anthropic'
import type { StoredAiProfile, StoredSettings } from '../../src/main/settings'
import type { SettingsStore } from '../../src/main/settings-store'

vi.mock('../../src/main/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/ai')>()
  return { ...actual, streamChat: vi.fn() }
})

vi.mock('../../src/main/ai-anthropic', () => ({ streamAnthropic: vi.fn() }))

const streamChatMock = vi.mocked(streamChat)
const streamAnthropicMock = vi.mocked(streamAnthropic)

const okResult = (text = '你好'): StreamChatResult => ({
  text,
  finishReason: 'stop'
})

const PROFILE: StoredAiProfile = {
  id: 'profile-1',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'encrypted-key',
  apiKeyEncrypted: true,
  model: 'test-model',
  enabled: true
}

const storedSettings = (profiles = [PROFILE]): StoredSettings => ({
  theme: 'light',
  language: 'zh',
  ai: { profiles, activeId: profiles[0]?.id ?? '' },
  library: { directory: '', autoAnalyze: true }
})

const makeSettings = (profiles = [PROFILE], decodedKey = 'sk-secret'): SettingsStore => {
  const read = vi.fn(async () => storedSettings(profiles))
  const decodeApiKey = vi.fn(() => decodedKey)
  return { read, decodeApiKey } as unknown as SettingsStore
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

describe('createAiRequester', () => {
  beforeEach(() => {
    streamChatMock.mockReset()
    streamChatMock.mockResolvedValue(okResult())
    streamAnthropicMock.mockReset()
    streamAnthropicMock.mockResolvedValue(okResult())
  })

  it('resolves the profile, decrypts the key and streams the reply', async () => {
    const settings = makeSettings()
    const request = baseRequest()
    const requester = createAiRequester(settings)

    const result = await requester.chat(request)

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
    expect(options.signal.aborted).toBe(false)

    options.onDelta('你')
    expect(request.onDelta).toHaveBeenCalledWith('你')
  })

  it('rejects a disabled profile before decrypting the key or calling the model', async () => {
    const settings = makeSettings([{ ...PROFILE, enabled: false }])
    const requester = createAiRequester(settings)

    await expect(requester.chat(baseRequest())).rejects.toThrow(
      '所选 AI 配置已禁用，请启用或选择其他配置'
    )
    expect(vi.mocked(settings.decodeApiKey)).not.toHaveBeenCalled()
    expect(streamChatMock).not.toHaveBeenCalled()
  })

  it('routes anthropic profiles to the Messages API gateway', async () => {
    const anthropic = createAiRequester(makeSettings([{ ...PROFILE, provider: 'anthropic' }]))

    await anthropic.chat(baseRequest())

    expect(streamAnthropicMock).toHaveBeenCalledTimes(1)
    expect(streamChatMock).not.toHaveBeenCalled()
  })

  it('normalizes messages before calling the model', async () => {
    const requester = createAiRequester(makeSettings())

    await requester.chat({
      ...baseRequest(),
      messages: [{ role: 'user', content: 'hi', extra: true }]
    })

    expect(streamChatMock.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('rejects invalid request and profile identifiers', async () => {
    const requester = createAiRequester(makeSettings())

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
    const missingProfile = createAiRequester(makeSettings([]))
    await expect(missingProfile.chat(baseRequest())).rejects.toThrow(
      '所选 AI 配置不存在，请重新选择'
    )

    const incomplete = createAiRequester(makeSettings([{ ...PROFILE, model: '' }]))
    await expect(incomplete.chat(baseRequest())).rejects.toThrow(
      '请先补全所选 AI 服务的 Base URL、API Key 和模型'
    )

    const insecure = createAiRequester(
      makeSettings([{ ...PROFILE, baseUrl: 'http://api.example.com/v1' }])
    )
    await expect(insecure.chat(baseRequest())).rejects.toThrow('Base URL')
    expect(streamChatMock).not.toHaveBeenCalled()
  })

  it('distinguishes a failed key decryption from a missing key', async () => {
    const encrypted = createAiRequester(makeSettings([PROFILE], ''))
    await expect(encrypted.chat(baseRequest())).rejects.toThrow('API Key 解密失败')

    const plain = createAiRequester(
      makeSettings([{ ...PROFILE, apiKey: '', apiKeyEncrypted: false }], '')
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
    const requester = createAiRequester(makeSettings())

    const first = requester.chat(baseRequest())
    await expect(requester.chat(baseRequest())).rejects.toThrow('请求标识重复')

    finish(okResult())
    await expect(first).resolves.toEqual(okResult())

    // 完成后同一个 id 可以再次使用
    streamChatMock.mockResolvedValue(okResult('再次'))
    await expect(requester.chat(baseRequest())).resolves.toEqual(okResult('再次'))
  })

  it('aborts an in-flight request by id', async () => {
    let finish: (result: StreamChatResult) => void = () => undefined
    streamChatMock.mockImplementation(
      () =>
        new Promise<StreamChatResult>((resolve) => {
          finish = resolve
        })
    )
    const requester = createAiRequester(makeSettings())

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
    const requester = createAiRequester(makeSettings())
    expect(() => requester.abort('missing')).not.toThrow()
  })

  it('bridges the caller signal into the request', async () => {
    const signals: AbortSignal[] = []
    streamChatMock.mockImplementation((options) => {
      signals.push(options.signal)
      return new Promise<StreamChatResult>(() => undefined)
    })
    const controller = new AbortController()
    const requester = createAiRequester(makeSettings())

    void requester.chat({ ...baseRequest(), signal: controller.signal })
    await flush()
    expect(signals[0].aborted).toBe(false)

    controller.abort()
    expect(signals[0].aborted).toBe(true)
  })

  it('aborts immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const requester = createAiRequester(makeSettings())

    void requester.chat({ ...baseRequest(), signal: controller.signal })
    await flush()

    expect(streamChatMock.mock.calls[0][0].signal.aborted).toBe(true)
  })
})
