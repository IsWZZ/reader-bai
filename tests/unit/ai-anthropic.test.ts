import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANTHROPIC_VERSION,
  anthropicMessagesUrl,
  streamAnthropic,
  toAnthropicMessages,
  toAnthropicTools
} from '../../src/main/ai-anthropic'
import type { ChatMessage, ChatToolDefinition, StreamChatOptions } from '../../src/main/ai'

interface FakeResponseInit {
  status?: number
  contentType?: string
  text?: string
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
    text: async () => init.text ?? '',
    json: async () => init.json,
    body
  } as unknown as Response
}

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

const MESSAGE_STOP = sse({ type: 'message_stop' })

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
  it('lifts system messages and converts tool calls and results', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'system', content: 'more rules' },
      { role: 'user', content: '找到 attention 相关论文' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: { name: 'library.search', arguments: '{"query":"attention"}' }
          }
        ]
      },
      { role: 'tool', content: '["Attention Is All You Need"]', tool_call_id: 'toolu_1' },
      { role: 'tool', content: '["BERT"]', tool_call_id: 'toolu_2' }
    ]

    expect(toAnthropicMessages(messages)).toEqual({
      system: 'rules\n\nmore rules',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '找到 attention 相关论文' }]
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'library.search',
              input: { query: 'attention' }
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: '["Attention Is All You Need"]'
            },
            { type: 'tool_result', tool_use_id: 'toolu_2', content: '["BERT"]' }
          ]
        }
      ]
    })
  })

  it('merges adjacent same-role messages and keeps assistant text', () => {
    const converted = toAnthropicMessages([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'answer' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: { name: 'paper.readPage', arguments: 'not json' }
          }
        ]
      }
    ])

    expect(converted.system).toBeUndefined()
    expect(converted.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' }
        ]
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'answer' },
          { type: 'tool_use', id: 'toolu_1', name: 'paper.readPage', input: {} }
        ]
      }
    ])
  })
})

describe('toAnthropicTools', () => {
  it('converts OpenAI function definitions to input_schema', () => {
    expect(toAnthropicTools(TOOLS)).toEqual([
      {
        name: 'library.search',
        description: '搜索论文',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query']
        }
      }
    ])
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
      tools: TOOLS,
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
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      stream: true,
      system: 'rules',
      tools: [
        {
          name: 'library.search',
          description: '搜索论文',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query']
          }
        }
      ],
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

    expect(result).toEqual({ text: '你好', toolCalls: [], finishReason: 'stop' })
    expect(deltas).toEqual(['你', '好'])
  })

  it('assembles tool_use input from content_block_delta fragments', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            sse({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', id: 'toolu_1', name: 'library.search', input: {} }
            }),
            sse({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: '{"query":' }
            }),
            sse({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: '"attention"}' }
            }),
            sse({ type: 'content_block_stop', index: 0 }),
            sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
            MESSAGE_STOP
          ]
        })
      )
    )

    const result = await streamAnthropic({ ...baseOptions(), tools: TOOLS })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toEqual([
      { id: 'toolu_1', name: 'library.search', arguments: '{"query":"attention"}' }
    ])
  })

  it('keeps multiple tool calls ordered by content block index', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          chunks: [
            sse({
              type: 'content_block_start',
              index: 1,
              content_block: { type: 'tool_use', id: 'toolu_b', name: 'paper.readPage', input: {} }
            }),
            sse({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', id: 'toolu_a', name: 'library.search', input: {} }
            }),
            sse({
              type: 'content_block_delta',
              index: 1,
              delta: { type: 'input_json_delta', partial_json: '{"page":2}' }
            }),
            sse({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: '{"query":"x"}' }
            }),
            sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
            MESSAGE_STOP
          ]
        })
      )
    )

    const result = await streamAnthropic({ ...baseOptions(), tools: TOOLS })

    expect(result.toolCalls.map((call) => call.id)).toEqual(['toolu_a', 'toolu_b'])
  })

  it('falls back to a non-streaming JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          contentType: 'application/json',
          json: {
            type: 'message',
            content: [
              { type: 'text', text: '完整回复' },
              { type: 'tool_use', id: 'toolu_2', name: 'paper.readPage', input: { page: 3 } }
            ],
            stop_reason: 'tool_use'
          }
        })
      )
    )
    const deltas: string[] = []

    const result = await streamAnthropic({
      ...baseOptions(),
      onDelta: (delta) => deltas.push(delta)
    })

    expect(result.text).toBe('完整回复')
    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toEqual([
      { id: 'toolu_2', name: 'paper.readPage', arguments: '{"page":3}' }
    ])
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
      toolCalls: [],
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
