import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANTHROPIC_VERSION,
  anthropicMessagesUrl,
  streamAnthropic,
  toAnthropicMessages
} from '../../src/main/ai-anthropic'
import type { ChatMessage, StreamChatOptions } from '../../src/main/ai'

interface FakeResponseInit {
  status?: number
  contentType?: string
  text?: string
  textRejects?: boolean
  json?: unknown
  chunks?: string[]
}

// 用普通对象模拟 Response，避免依赖 jsdom 是否提供 fetch/Response
const fakeResponse = (init: FakeResponseInit = {}): Response => {
  const status = init.status ?? 200
  let body: ReadableStream<Uint8Array> | null = null
  if (init.chunks) {
    const encoder = new TextEncoder()
    body = new ReadableStream({
      start(controller) {
        for (const chunk of init.chunks ?? []) controller.enqueue(encoder.encode(chunk))
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
    text: async () => {
      if (init.textRejects) throw new Error('stream closed')
      return init.text ?? ''
    },
    json: async () => init.json,
    body
  } as unknown as Response
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

const MESSAGE_STOP = sse({ type: 'message_stop' })

const baseOptions = (): StreamChatOptions => ({
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-ant-secret',
  model: 'claude-test',
  messages: [{ role: 'user', content: 'hi' }],
  signal: new AbortController().signal,
  onDelta: (): void => undefined
})

describe('anthropicMessagesUrl', () => {
  it('appends /v1/messages to a bare host', () => {
    expect(anthropicMessagesUrl('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1/messages'
    )
    expect(anthropicMessagesUrl('  https://api.anthropic.com/  ')).toBe(
      'https://api.anthropic.com/v1/messages'
    )
    expect(anthropicMessagesUrl('https://proxy.example/anthropic')).toBe(
      'https://proxy.example/anthropic/v1/messages'
    )
  })

  it('keeps a base URL that already ends with /v1 or /messages', () => {
    expect(anthropicMessagesUrl('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/messages'
    )
    expect(anthropicMessagesUrl('https://api.anthropic.com/v1/messages')).toBe(
      'https://api.anthropic.com/v1/messages'
    )
  })

  it('returns an empty string when the base URL is blank', () => {
    expect(anthropicMessagesUrl('   ')).toBe('')
  })
})

describe('toAnthropicMessages', () => {
  it('lifts system messages and converts user/assistant text', () => {
    const result = toAnthropicMessages([
      { role: 'system', content: 'rules' },
      { role: 'system', content: 'more rules' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ])

    expect(result).toEqual({
      system: 'rules\n\nmore rules',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' }
      ]
    })
  })

  it('merges adjacent messages with the same role', () => {
    const result = toAnthropicMessages([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'answer' }
    ])

    expect(result).toEqual({
      messages: [
        { role: 'user', content: 'first\n\nsecond' },
        { role: 'assistant', content: 'answer' }
      ]
    })
  })

  it('skips empty messages', () => {
    expect(
      toAnthropicMessages([
        { role: 'system', content: '  ' },
        { role: 'user', content: '' },
        { role: 'assistant', content: 'answer' }
      ])
    ).toEqual({
      messages: [{ role: 'assistant', content: 'answer' }]
    })
  })
})

describe('streamAnthropic', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends the Messages API headers and converted body', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ chunks: [MESSAGE_STOP] }))
    vi.stubGlobal('fetch', fetchMock)

    const messages: ChatMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hi' }
    ]

    await streamAnthropic({
      ...baseOptions(),
      messages,
      temperature: 0.3,
      maxOutputTokens: 1024
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers).toEqual({
      'x-api-key': 'sk-ant-secret',
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json'
    })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'claude-test',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      system: 'rules',
      temperature: 0.3
    })
  })

  it('uses a default max_tokens because the Messages API requires it', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ chunks: [MESSAGE_STOP] }))
    vi.stubGlobal('fetch', fetchMock)

    await streamAnthropic(baseOptions())

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ max_tokens: 4096 })
  })

  it('rejects a blank base URL before calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(streamAnthropic({ ...baseOptions(), baseUrl: '   ' })).rejects.toThrow(
      'AI 服务地址未配置'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts text delivered in content_block_start', async () => {
    const deltas: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            sse({ type: 'content_block_start', index: 0 }),
            sse({
              type: 'content_block_start',
              content_block: { type: 'text', text: '开头' }
            }),
            sse({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: '结尾' }
            }),
            MESSAGE_STOP
          ]
        })
      )
    )

    const result = await streamAnthropic({
      ...baseOptions(),
      onDelta: (delta) => deltas.push(delta)
    })

    expect(result.text).toBe('开头结尾')
    expect(deltas).toEqual(['开头', '结尾'])
  })

  it('reads stop_reason from message_start', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            sse({ type: 'message_start', message: { stop_reason: 'max_tokens' } }),
            MESSAGE_STOP
          ]
        })
      )
    )

    const result = await streamAnthropic(baseOptions())

    expect(result.finishReason).toBe('length')
  })

  it('ignores comments, malformed JSON, event lines and [DONE]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            ': keep-alive\n\n',
            'event: content_block_delta\n\n',
            'data: not-json\n\n',
            'data: [DONE]\n\n',
            sse({ type: 'content_block_delta' }),
            sse({
              type: 'content_block_start',
              index: 1,
              content_block: { type: 'tool_use' }
            }),
            sse({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'ok' }
            }),
            MESSAGE_STOP
          ]
        })
      )
    )

    const result = await streamAnthropic(baseOptions())

    expect(result.text).toBe('ok')
  })

  it('keeps a final event that arrives without a trailing newline', async () => {
    const finalLine = `data: ${JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'tail' }
    })}`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ chunks: [finalLine] }))
    )

    const result = await streamAnthropic(baseOptions())

    expect(result.text).toBe('tail')
    expect(result.finishReason).toBe('stop')
  })

  it('streams text deltas until message_stop', async () => {
    const deltas: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            sse({ type: 'message_start', message: { stop_reason: null } }),
            sse({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' }
            }),
            sse({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: '你' }
            }),
            sse({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: '好' }
            }),
            sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
            sse({ type: 'ping' }),
            MESSAGE_STOP
          ]
        })
      )
    )

    const result = await streamAnthropic({
      ...baseOptions(),
      onDelta: (delta) => deltas.push(delta)
    })

    expect(result).toEqual({ text: '你好', finishReason: 'stop' })
    expect(deltas).toEqual(['你', '好'])
  })

  it('reads a non-streaming JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          contentType: 'application/json',
          json: {
            type: 'message',
            content: [{ type: 'text', text: '完整回复' }],
            stop_reason: 'end_turn'
          }
        })
      )
    )

    const deltas: string[] = []
    const result = await streamAnthropic({
      ...baseOptions(),
      onDelta: (delta) => deltas.push(delta)
    })

    expect(result).toEqual({ text: '完整回复', finishReason: 'stop' })
    expect(deltas).toEqual(['完整回复'])
  })

  it('maps max_tokens to a length finish reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            sse({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }),
            MESSAGE_STOP
          ]
        })
      )
    )

    const result = await streamAnthropic(baseOptions())

    expect(result.finishReason).toBe('length')
  })

  it('throws on an error event without leaking the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [sse({ type: 'error', error: { type: 'overloaded_error', message: '服务繁忙' } })]
        })
      )
    )

    const error = await streamAnthropic(baseOptions()).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('AI 服务返回错误：服务繁忙')
    expect((error as Error).message).not.toContain('sk-ant-secret')
  })

  it('falls back to the error type and then to a generic message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        fakeResponse({ chunks: [sse({ type: 'error', error: { type: 'overloaded_error' } })] })
      )
      .mockResolvedValueOnce(fakeResponse({ chunks: [sse({ type: 'error' })] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(streamAnthropic(baseOptions())).rejects.toThrow(
      'AI 服务返回错误：overloaded_error'
    )
    await expect(streamAnthropic(baseOptions())).rejects.toThrow('AI 服务返回错误：未知错误')
  })

  it('reports HTTP errors without leaking the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ status: 401, text: 'invalid x-api-key' }))
    )

    const error = await streamAnthropic(baseOptions()).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('AI 服务返回 401')
    expect((error as Error).message).not.toContain('sk-ant-secret')
  })

  it('reports the status when the error body cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ status: 500, textRejects: true }))
    )

    await expect(streamAnthropic(baseOptions())).rejects.toThrow('AI 服务返回 500:')
  })

  it('returns an aborted result when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
          })
      )
    )

    await expect(streamAnthropic({ ...baseOptions(), signal: controller.signal })).resolves.toEqual(
      {
        text: '',
        finishReason: 'aborted'
      }
    )
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

    const promise = streamAnthropic({ ...baseOptions(), signal: controller.signal })
    controller.abort()

    await expect(promise).resolves.toEqual({
      text: '',
      finishReason: 'aborted'
    })
  })

  it('turns network failures into a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )

    await expect(streamAnthropic(baseOptions())).rejects.toThrow(
      '无法连接到 AI 服务，请检查 Base URL 与网络'
    )
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

    const promise = streamAnthropic(baseOptions())
    const assertion = expect(promise).rejects.toThrow('AI 请求超时')
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
  })
})
