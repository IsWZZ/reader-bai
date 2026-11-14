import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chatCompletionsUrl,
  normalizeChatMessages,
  streamChat,
  streamChatCompletion,
  type ChatMessage,
  type ChatToolDefinition,
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

const ssePayload = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

const toolFrame = (toolCalls: unknown, finishReason?: string): string =>
  ssePayload({
    choices: [{ delta: { tool_calls: toolCalls }, finish_reason: finishReason }]
  })

const TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'library.search',
      description: '搜索论文',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
      }
    }
  }
]

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

  it('accepts assistant tool calls and tool result messages', () => {
    const messages = normalizeChatMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'library.search', arguments: '{"query":"attention"}' }
          }
        ]
      },
      { role: 'tool', content: '[]', tool_call_id: 'call_1' }
    ])

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'library.search', arguments: '{"query":"attention"}' }
          }
        ]
      },
      { role: 'tool', content: '[]', tool_call_id: 'call_1' }
    ])
  })

  it('rejects non-object messages, null content and non-array tool calls', () => {
    expect(() => normalizeChatMessages([null])).toThrow('消息格式不正确')
    expect(() => normalizeChatMessages([{ role: 'user', content: null }])).toThrow('消息格式不正确')
    expect(() =>
      normalizeChatMessages([{ role: 'assistant', content: 'x', tool_calls: 'not a list' }])
    ).toThrow('消息格式不正确')
    expect(() =>
      normalizeChatMessages([
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'library.search', arguments: '{}' }
            },
            null
          ]
        }
      ])
    ).toThrow('消息格式不正确')
  })

  it('rejects malformed tool calls and tool messages', () => {
    expect(() =>
      normalizeChatMessages([
        { role: 'assistant', content: 'x', tool_calls: [{ id: '', type: 'function' }] }
      ])
    ).toThrow('消息格式不正确')
    expect(() =>
      normalizeChatMessages([
        {
          role: 'user',
          content: 'x',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'library.search', arguments: '{}' }
            }
          ]
        }
      ])
    ).toThrow('消息格式不正确')
    expect(() =>
      normalizeChatMessages([{ role: 'assistant', content: null, tool_calls: [] }])
    ).toThrow('消息格式不正确')
    expect(() =>
      normalizeChatMessages([{ role: 'user', content: 'x', tool_call_id: 'call_1' }])
    ).toThrow('消息格式不正确')
  })
})

describe('streamChat tool calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('assembles fragmented streamed tool calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            toolFrame([
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'library.search', arguments: '{"query":' }
              }
            ]),
            toolFrame([{ index: 0, function: { arguments: '"attention"}' } }]),
            toolFrame([], 'tool_calls'),
            'data: [DONE]\n\n'
          ]
        })
      )
    )

    const result = await streamChat({ ...baseOptions(), tools: TOOLS })

    expect(result.text).toBe('')
    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'library.search', arguments: '{"query":"attention"}' }
    ])
  })

  it('keeps multiple tool calls ordered by index', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            toolFrame([
              {
                index: 1,
                id: 'call_b',
                type: 'function',
                function: { name: 'paper.readPage', arguments: '{"page":2}' }
              },
              {
                index: 0,
                id: 'call_a',
                type: 'function',
                function: { name: 'library.search', arguments: '{"query":"x"}' }
              }
            ]),
            toolFrame([], 'tool_calls'),
            'data: [DONE]\n\n'
          ]
        })
      )
    )

    const result = await streamChat({ ...baseOptions(), tools: TOOLS })

    expect(result.toolCalls.map((call) => call.id)).toEqual(['call_a', 'call_b'])
  })

  it('reads tool calls from a non-streaming response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          contentType: 'application/json',
          json: {
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_2',
                      type: 'function',
                      function: { name: 'paper.readPage', arguments: '{"page":3}' }
                    }
                  ]
                },
                finish_reason: 'tool_calls'
              }
            ]
          }
        })
      )
    )

    const result = await streamChat({ ...baseOptions(), tools: TOOLS })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toEqual([
      { id: 'call_2', name: 'paper.readPage', arguments: '{"page":3}' }
    ])
  })

  it('sends tool definitions and tool result messages to the provider', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ chunks: ['data: [DONE]\n\n'] }))
    vi.stubGlobal('fetch', fetchMock)

    const messages: ChatMessage[] = [
      { role: 'user', content: '找 attention 相关论文' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'library.search', arguments: '{"query":"attention"}' }
          }
        ]
      },
      { role: 'tool', content: '["Attention Is All You Need"]', tool_call_id: 'call_1' }
    ]

    await streamChat({ ...baseOptions(), messages, tools: TOOLS })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.tools).toEqual(TOOLS)
    expect(body.messages).toEqual(messages)
  })

  it('treats a stop finish reason as tool_calls when calls are present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            toolFrame(
              [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'library.search', arguments: '{"query":"x"}' }
                }
              ],
              'stop'
            ),
            'data: [DONE]\n\n'
          ]
        })
      )
    )

    const result = await streamChat({ ...baseOptions(), tools: TOOLS })

    expect(result.finishReason).toBe('tool_calls')
  })

  it('ignores malformed SSE payloads and chunks without choices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: ['data: not-json\n\n', ssePayload({}), sseFrame('ok'), 'data: [DONE]\n\n']
        })
      )
    )

    const result = await streamChat({ ...baseOptions(), tools: TOOLS })

    expect(result).toEqual({ text: 'ok', toolCalls: [], finishReason: 'stop' })
  })

  it('ignores malformed tool call deltas and empty tool-call finishes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            toolFrame('not a list'),
            toolFrame([null]),
            toolFrame([], 'tool_calls'),
            'data: [DONE]\n\n'
          ]
        })
      )
    )

    const result = await streamChat({ ...baseOptions(), tools: TOOLS })

    // 没有有效的工具调用时不能让调用方误以为还需要继续循环
    expect(result.toolCalls).toEqual([])
    expect(result.finishReason).toBe('stop')
  })

  it('sends optional temperature and output token limits', async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ chunks: ['data: [DONE]\n\n'] }))
    vi.stubGlobal('fetch', fetchMock)

    await streamChat({ ...baseOptions(), temperature: 0.2, maxOutputTokens: 512 })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      temperature: 0.2,
      max_tokens: 512
    })
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

  it('returns an aborted result when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        expect(init.signal?.aborted).toBe(true)
        return Promise.reject(new DOMException('Aborted', 'AbortError'))
      })
    )

    const result = await streamChat({ ...baseOptions(), signal: controller.signal })

    expect(result).toEqual({ text: '', toolCalls: [], finishReason: 'aborted' })
  })

  it('turns network failures into a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )

    await expect(runStream()).rejects.toThrow('无法连接到 AI 服务，请检查 Base URL 与网络')
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
