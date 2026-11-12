import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chatCompletionsUrl,
  normalizeChatMessages,
  streamChatCompletion,
  type ChatMessage,
  type StreamChatOptions
} from '../../src/main/ai'

const encoder = new TextEncoder()

interface FakeResponseInit {
  status?: number
  contentType?: string
  text?: string
  json?: unknown
  chunks?: (string | Uint8Array)[]
}

// 用普通对象模拟 Response，避免依赖 jsdom 是否提供 fetch/Response
const fakeResponse = (init: FakeResponseInit = {}): Response => {
  const status = init.status ?? 200
  let body: ReadableStream<Uint8Array> | null = null
  if (init.chunks) {
    body = new ReadableStream({
      start(controller) {
        for (const chunk of init.chunks ?? []) {
          controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
        }
        controller.close()
      }
    })
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? (init.contentType ?? 'text/event-stream') : null
    },
    text: async () => init.text ?? '',
    json: async () => init.json,
    body
  } as unknown as Response
}

const sseFrame = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

const baseOptions = (): StreamChatOptions => ({
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-secret',
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
  signal: new AbortController().signal,
  onDelta: (): void => undefined
})

const runStream = (overrides: Partial<ReturnType<typeof baseOptions>> = {}): Promise<string> =>
  streamChatCompletion({ ...baseOptions(), ...overrides })

describe('chatCompletionsUrl', () => {
  it('normalizes trailing slashes and appends the endpoint', () => {
    expect(chatCompletionsUrl('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
    expect(chatCompletionsUrl('  https://api.example.com/v1  ')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })

  it('keeps a full endpoint untouched', () => {
    expect(chatCompletionsUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })

  it('returns an empty string when the base URL is blank', () => {
    expect(chatCompletionsUrl('   ')).toBe('')
  })
})

describe('normalizeChatMessages', () => {
  it('accepts valid messages and strips extra fields', () => {
    const messages = normalizeChatMessages([
      { role: 'system', content: 'a', extra: true },
      { role: 'user', content: 'b' }
    ])

    expect(messages).toEqual([
      { role: 'system', content: 'a' },
      { role: 'user', content: 'b' }
    ])
  })

  it('rejects malformed payloads', () => {
    expect(() => normalizeChatMessages('nope')).toThrow('消息格式不正确')
    expect(() => normalizeChatMessages([])).toThrow('消息不能为空')
    expect(() => normalizeChatMessages([{ role: 'tool', content: 'x' }])).toThrow('消息格式不正确')
    expect(() => normalizeChatMessages([{ role: 'user', content: 1 }])).toThrow('消息格式不正确')
    expect(() => normalizeChatMessages([{ content: 'x' }])).toThrow('消息格式不正确')
  })

  it('rejects too many messages and oversized content', () => {
    const many: ChatMessage[] = Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' }))
    expect(() => normalizeChatMessages(many)).toThrow('消息数量不能超过 40 条')
    expect(() => normalizeChatMessages([{ role: 'user', content: 'x'.repeat(40001) }])).toThrow(
      '消息过长'
    )
  })
})

describe('streamChatCompletion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('streams deltas until [DONE]', async () => {
    const deltas: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({ chunks: [sseFrame('你'), sseFrame('好'), 'data: [DONE]\n\n'] })
      )
    )

    const text = await runStream({ onDelta: (delta) => deltas.push(delta) })

    expect(text).toBe('你好')
    expect(deltas).toEqual(['你', '好'])
  })

  it('reassembles lines and multi-byte characters split across chunks', async () => {
    const full = sseFrame('你好世界') + 'data: [DONE]\n\n'
    const bytes = encoder.encode(full)
    // 在“好”这个三字节字符中间切开
    const start = encoder.encode(full.slice(0, full.indexOf('好'))).length
    const cut = start + 1

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ chunks: [bytes.slice(0, cut), bytes.slice(cut)] }))
    )

    await expect(runStream()).resolves.toBe('你好世界')
  })

  it('handles CRLF, comments and a trailing line without newline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            ': keep-alive\r\n\r\n',
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'A' } }] })}\r\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'B' } }] })}`
          ]
        })
      )
    )

    await expect(runStream()).resolves.toBe('AB')
  })

  it('sends the model, stream flag and bearer token', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ chunks: ['data: [DONE]\n\n'] }))
    vi.stubGlobal('fetch', fetchMock)

    await runStream()

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-secret' })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true
    })
  })

  it('falls back to a non-streaming JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          contentType: 'application/json',
          json: { choices: [{ message: { content: '完整回复' } }] }
        })
      )
    )
    const deltas: string[] = []

    const text = await runStream({ onDelta: (delta) => deltas.push(delta) })

    expect(text).toBe('完整回复')
    expect(deltas).toEqual(['完整回复'])
  })

  it('reports HTTP errors without leaking the API key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ status: 401, text: 'invalid credentials' }))
    )

    const error = await runStream().catch((err: unknown) => err)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('AI 服务返回 401')
    expect((error as Error).message).not.toContain('sk-secret')
  })

  it('returns the partial text when the caller aborts', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          })
      )
    )

    const promise = runStream({ signal: controller.signal })
    controller.abort()

    await expect(promise).resolves.toBe('')
  })

  it('times out when the service never responds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          })
      )
    )

    const promise = runStream()
    const assertion = expect(promise).rejects.toThrow('AI 请求超时')
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
  })
})
