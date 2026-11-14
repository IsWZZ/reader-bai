// OpenAI 兼容的流式对话与工具调用实现。
// 这里刻意不依赖 electron，方便在 Vitest 中直接对解析逻辑做单元测试。

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatMessage {
  role: ChatRole
  content: string | null
  /** assistant 发起的工具调用 */
  tool_calls?: ChatToolCall[]
  /** tool 消息对应的调用 id */
  tool_call_id?: string
}

/** 发给模型的工具定义，保持 OpenAI 兼容格式 */
export interface ChatToolDefinition {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export type ChatFinishReason = 'stop' | 'tool_calls' | 'length' | 'aborted' | 'error'

/** 归一化后的工具调用：arguments 是模型返回的原始 JSON 字符串 */
export interface ChatToolCallResult {
  id: string
  name: string
  arguments: string
}

export interface StreamChatResult {
  text: string
  toolCalls: ChatToolCallResult[]
  finishReason: ChatFinishReason
}

export interface StreamChatOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  signal: AbortSignal
  /** 每收到一段增量就回调一次 */
  onDelta: (delta: string) => void
  tools?: ChatToolDefinition[]
  temperature?: number
  maxOutputTokens?: number
}

const MAX_MESSAGES = 40
const MAX_TOTAL_CHARS = 40000
const MAX_ERROR_BODY = 500
const REQUEST_TIMEOUT_MS = 60_000

const ROLES = new Set<ChatRole>(['system', 'user', 'assistant', 'tool'])

interface WireToolCallDelta {
  index?: number
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

interface WireMessagePart {
  content?: string | null
  tool_calls?: WireToolCallDelta[]
}

interface ChatCompletionChunk {
  choices?: {
    delta?: WireMessagePart
    message?: WireMessagePart
    finish_reason?: string | null
  }[]
}

/** Base URL 统一补上 /chat/completions；已经写全的地址保持原样 */
export const chatCompletionsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`
}

const normalizeToolCalls = (raw: unknown): ChatToolCall[] | undefined => {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new Error('消息格式不正确')

  return raw.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('消息格式不正确')
    const call = item as Partial<ChatToolCall>
    if (
      typeof call.id !== 'string' ||
      !call.id ||
      call.type !== 'function' ||
      !call.function ||
      typeof call.function.name !== 'string' ||
      !call.function.name ||
      typeof call.function.arguments !== 'string'
    ) {
      throw new Error('消息格式不正确')
    }
    return {
      id: call.id,
      type: 'function' as const,
      function: { name: call.function.name, arguments: call.function.arguments }
    }
  })
}

/** 校验来自渲染进程/插件的消息，并把它们转成普通对象（结构化克隆前的防线） */
export const normalizeChatMessages = (input: unknown): ChatMessage[] => {
  if (!Array.isArray(input)) throw new Error('消息格式不正确')
  if (input.length === 0) throw new Error('消息不能为空')
  if (input.length > MAX_MESSAGES) throw new Error(`消息数量不能超过 ${MAX_MESSAGES} 条`)

  let total = 0
  const messages = input.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('消息格式不正确')
    const item = raw as Partial<ChatMessage>
    if (!item.role || !ROLES.has(item.role)) throw new Error('消息格式不正确')

    const content = item.content
    if (content !== null && typeof content !== 'string') throw new Error('消息格式不正确')
    if (item.role !== 'assistant' && content === null) throw new Error('消息格式不正确')

    const toolCalls = normalizeToolCalls(item.tool_calls)
    if (toolCalls && item.role !== 'assistant') throw new Error('消息格式不正确')

    const toolCallId = typeof item.tool_call_id === 'string' ? item.tool_call_id : undefined
    if (item.role !== 'tool' && item.tool_call_id !== undefined) {
      throw new Error('消息格式不正确')
    }
    if (item.role === 'tool' && !toolCallId) throw new Error('消息格式不正确')
    if (item.role === 'assistant' && content === null && !toolCalls?.length) {
      throw new Error('消息格式不正确')
    }

    total += (content ?? '').length
    for (const call of toolCalls ?? []) {
      total += call.function.name.length + call.function.arguments.length
    }

    const message: ChatMessage = { role: item.role, content }
    if (toolCalls?.length) message.tool_calls = toolCalls
    if (toolCallId) message.tool_call_id = toolCallId
    return message
  })

  if (total > MAX_TOTAL_CHARS) throw new Error('消息过长')
  return messages
}

const DONE = Symbol('done')

/** 解析一条 SSE data 行：返回 chunk、结束标记或 null（忽略） */
const parseSseLine = (line: string): ChatCompletionChunk | typeof DONE | null => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return null

  const payload = trimmed.slice('data:'.length).trim()
  if (payload === '[DONE]') return DONE

  try {
    return JSON.parse(payload) as ChatCompletionChunk
  } catch {
    // 非 JSON 的心跳/注释行直接跳过
    return null
  }
}

const normalizeFinishReason = (reason: string): ChatFinishReason => {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_calls'
  if (reason === 'length') return 'length'
  return 'stop'
}

interface ToolCallAccumulator {
  id: string
  name: string
  arguments: string
}

interface MutableStreamResult {
  text: string
  finishReason: ChatFinishReason
  toolCalls: Map<number, ToolCallAccumulator>
}

const collectToolCalls = (
  calls: Map<number, ToolCallAccumulator>,
  deltas: WireToolCallDelta[] | undefined
): void => {
  if (!Array.isArray(deltas)) return

  for (const delta of deltas) {
    if (!delta || typeof delta !== 'object') continue
    const index = typeof delta.index === 'number' ? delta.index : calls.size
    const current = calls.get(index) ?? { id: '', name: '', arguments: '' }

    if (typeof delta.id === 'string' && delta.id) current.id = delta.id
    if (typeof delta.function?.name === 'string' && delta.function.name) {
      current.name = delta.function.name
    }
    if (typeof delta.function?.arguments === 'string') {
      current.arguments += delta.function.arguments
    }

    calls.set(index, current)
  }
}

const finalizeToolCalls = (calls: Map<number, ToolCallAccumulator>): ChatToolCallResult[] =>
  [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, call]) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: call.arguments || '{}'
    }))
    .filter((call) => call.name)

const applyChunk = (
  chunk: ChatCompletionChunk,
  result: MutableStreamResult,
  onDelta: (delta: string) => void
): void => {
  const choice = chunk.choices?.[0]
  if (!choice) return

  const payload = choice.delta ?? choice.message
  if (payload) {
    if (typeof payload.content === 'string' && payload.content) {
      result.text += payload.content
      onDelta(payload.content)
    }
    collectToolCalls(result.toolCalls, payload.tool_calls)
  }

  if (choice.finish_reason) {
    result.finishReason = normalizeFinishReason(choice.finish_reason)
  }
}

const buildResult = (
  result: MutableStreamResult,
  forcedReason?: ChatFinishReason
): StreamChatResult => {
  const toolCalls = finalizeToolCalls(result.toolCalls)
  let finishReason = forcedReason ?? result.finishReason
  if (!forcedReason) {
    if (toolCalls.length > 0) finishReason = 'tool_calls'
    else if (finishReason === 'tool_calls') finishReason = 'stop'
  }
  return { text: result.text, toolCalls, finishReason }
}

/**
 * 发起一次流式对话，返回文本和完整的工具调用。
 * - 文本增量通过 onDelta 回调
 * - 工具调用参数可能在多个 chunk 中分片，这里会拼装完整后再返回
 * - 用户中止时返回已收到的部分结果，finishReason 为 aborted
 */
export const streamChat = async (options: StreamChatOptions): Promise<StreamChatResult> => {
  const url = chatCompletionsUrl(options.baseUrl)
  if (!url) throw new Error('AI 服务地址未配置')

  const controller = new AbortController()
  let timedOut = false
  const result: MutableStreamResult = {
    text: '',
    finishReason: 'stop',
    toolCalls: new Map()
  }

  const abort = (): void => controller.abort()
  if (options.signal.aborted) {
    abort()
  } else {
    options.signal.addEventListener('abort', abort, { once: true })
  }
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      stream: true
    }
    if (options.tools && options.tools.length > 0) body.tools = options.tools
    if (typeof options.temperature === 'number') body.temperature = options.temperature
    if (typeof options.maxOutputTokens === 'number') body.max_tokens = options.maxOutputTokens

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      throw new Error(`AI 服务返回 ${response.status}: ${errorBody.slice(0, MAX_ERROR_BODY)}`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream') || !response.body) {
      const payload = (await response.json()) as ChatCompletionChunk
      applyChunk(payload, result, options.onDelta)
      return buildResult(result)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false

    while (!finished) {
      const chunk = await reader.read()
      if (chunk.done) break

      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      // 最后一段可能被网络分片截断，留到下一次拼接
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const parsed = parseSseLine(line)
        if (parsed === null) continue
        if (parsed === DONE) {
          finished = true
          break
        }
        applyChunk(parsed, result, options.onDelta)
      }
    }

    if (!finished) {
      // 响应结束时把残留的半行和未 flush 的多字节字符一起处理掉
      buffer += decoder.decode()
      const parsed = parseSseLine(buffer)
      if (parsed !== null && parsed !== DONE) {
        applyChunk(parsed, result, options.onDelta)
      }
    } else {
      void reader.cancel().catch(() => undefined)
    }

    return buildResult(result)
  } catch (error) {
    if (timedOut) throw new Error('AI 请求超时，请稍后重试', { cause: error })
    // 用户主动停止：把已经收到的内容当作结果返回
    if (controller.signal.aborted) return buildResult(result, 'aborted')
    // Node fetch 在连接失败时抛 TypeError，转成可读的提示
    if (error instanceof TypeError) {
      throw new Error('无法连接到 AI 服务，请检查 Base URL 与网络', { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
    options.signal.removeEventListener('abort', abort)
  }
}

/** 兼容旧调用方：只关心文本时使用这个包装 */
export const streamChatCompletion = async (options: StreamChatOptions): Promise<string> => {
  const result = await streamChat(options)
  return result.text
}
