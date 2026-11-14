// Anthropic Messages API 的流式对话与工具调用实现。
// 与 ai.ts 一样刻意不依赖 electron，方便在 Vitest 中直接测试协议转换和 SSE 解析。
// 对外仍然使用 OpenAI 风格的 ChatMessage / ChatToolDefinition，转换只发生在这一层。

import type {
  ChatFinishReason,
  ChatMessage,
  ChatToolCallResult,
  ChatToolDefinition,
  StreamChatOptions,
  StreamChatResult
} from './ai'

export const ANTHROPIC_VERSION = '2023-06-01'
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096

const MAX_ERROR_BODY = 500
const REQUEST_TIMEOUT_MS = 60_000

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

/**
 * Base URL 统一补上 /v1/messages。
 * 已写到 /v1 或完整 /messages 的地址都保持可用，方便第三方 Anthropic 兼容服务。
 */
export const anthropicMessagesUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/\/messages$/i.test(trimmed)) return trimmed
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
}

const parseToolInput = (raw: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 参数不是合法 JSON 时交给平台工具层校验；这里先按空对象发送
  }
  return {}
}

/**
 * 把内部的 OpenAI 风格消息转成 Anthropic Messages：
 * - system 消息提升为顶层 system 字段
 * - assistant 的 tool_calls 转成 tool_use 内容块
 * - tool 消息转成 user 里的 tool_result 内容块
 * Anthropic 要求角色交替，因此相邻同角色消息会合并成一个内容块数组。
 */
export const toAnthropicMessages = (
  messages: ChatMessage[]
): { system?: string; messages: AnthropicMessage[] } => {
  const system: string[] = []
  const converted: AnthropicMessage[] = []

  const push = (role: 'user' | 'assistant', blocks: AnthropicContentBlock[]): void => {
    if (blocks.length === 0) return
    const last = converted[converted.length - 1]
    if (last && last.role === role) {
      last.content.push(...blocks)
      return
    }
    converted.push({ role, content: blocks })
  }

  for (const message of messages) {
    if (message.role === 'system') {
      const text = message.content?.trim()
      if (text) system.push(text)
      continue
    }

    if (message.role === 'user') {
      if (message.content) push('user', [{ type: 'text', text: message.content }])
      continue
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = []
      if (message.content) blocks.push({ type: 'text', text: message.content })
      for (const call of message.tool_calls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: parseToolInput(call.function.arguments)
        })
      }
      push('assistant', blocks)
      continue
    }

    if (message.tool_call_id) {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: message.content ?? ''
        }
      ])
    }
  }

  return system.length > 0
    ? { system: system.join('\n\n'), messages: converted }
    : { messages: converted }
}

export const toAnthropicTools = (tools: ChatToolDefinition[]): AnthropicTool[] =>
  tools.map((tool) => {
    const definition: AnthropicTool = {
      name: tool.function.name,
      input_schema: tool.function.parameters
    }
    if (tool.function.description) definition.description = tool.function.description
    return definition
  })

interface WireContentBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

interface WireAnthropicEvent {
  type?: string
  index?: number
  content_block?: WireContentBlock
  delta?: {
    type?: string
    text?: string
    partial_json?: string
    stop_reason?: string | null
  }
  message?: { stop_reason?: string | null }
  stop_reason?: string | null
  content?: WireContentBlock[]
  error?: { type?: string; message?: string }
}

interface ToolCallAccumulator {
  id: string
  name: string
  arguments: string
  /** content_block_start 里可能直接给出完整 input（非流式响应） */
  initialInput?: unknown
}

interface MutableStreamResult {
  text: string
  finishReason: ChatFinishReason
  toolCalls: Map<number, ToolCallAccumulator>
}

const normalizeStopReason = (reason: string | null | undefined): ChatFinishReason => {
  if (reason === 'tool_use') return 'tool_calls'
  if (reason === 'max_tokens') return 'length'
  return 'stop'
}

const applyContentBlocks = (
  blocks: WireContentBlock[],
  result: MutableStreamResult,
  onDelta: (delta: string) => void
): void => {
  blocks.forEach((block, index) => {
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      result.text += block.text
      onDelta(block.text)
    } else if (block.type === 'tool_use') {
      result.toolCalls.set(index, {
        id: typeof block.id === 'string' ? block.id : '',
        name: typeof block.name === 'string' ? block.name : '',
        arguments: '',
        initialInput: block.input
      })
    }
  })
}

const applyEvent = (
  event: WireAnthropicEvent,
  result: MutableStreamResult,
  onDelta: (delta: string) => void
): void => {
  // 非流式 JSON 响应：content 数组一次性给出全部内容
  if (Array.isArray(event.content)) {
    applyContentBlocks(event.content, result, onDelta)
    if (event.stop_reason) result.finishReason = normalizeStopReason(event.stop_reason)
    return
  }

  if (event.type === 'message_start') {
    if (event.message?.stop_reason) {
      result.finishReason = normalizeStopReason(event.message.stop_reason)
    }
    return
  }

  if (event.type === 'content_block_start') {
    const block = event.content_block
    if (!block) return
    const index = typeof event.index === 'number' ? event.index : result.toolCalls.size

    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      result.text += block.text
      onDelta(block.text)
    } else if (block.type === 'tool_use') {
      result.toolCalls.set(index, {
        id: typeof block.id === 'string' ? block.id : '',
        name: typeof block.name === 'string' ? block.name : '',
        arguments: '',
        initialInput: block.input
      })
    }
    return
  }

  if (event.type === 'content_block_delta') {
    const delta = event.delta
    if (!delta) return
    if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
      result.text += delta.text
      onDelta(delta.text)
      return
    }
    if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const index = typeof event.index === 'number' ? event.index : result.toolCalls.size - 1
      const current = result.toolCalls.get(index) ?? { id: '', name: '', arguments: '' }
      current.arguments += delta.partial_json
      result.toolCalls.set(index, current)
    }
    return
  }

  if (event.type === 'message_delta') {
    if (event.delta?.stop_reason) {
      result.finishReason = normalizeStopReason(event.delta.stop_reason)
    }
    return
  }

  if (event.type === 'error') {
    const message = event.error?.message || event.error?.type || '未知错误'
    throw new Error(`AI 服务返回错误：${message}`)
  }

  // ping / content_block_stop / message_stop 不需要额外处理
}

const finalizeToolCalls = (calls: Map<number, ToolCallAccumulator>): ChatToolCallResult[] =>
  [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, call]) => ({
      id: call.id || `toolu_${index}`,
      name: call.name,
      arguments:
        call.arguments ||
        (call.initialInput === undefined ? '{}' : JSON.stringify(call.initialInput))
    }))
    .filter((call) => call.name)

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

/** 解析一条 SSE data 行；event 行、注释和空行直接忽略 */
const parseSseLine = (line: string): WireAnthropicEvent | null => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return null

  const payload = trimmed.slice('data:'.length).trim()
  if (!payload || payload === '[DONE]') return null

  try {
    return JSON.parse(payload) as WireAnthropicEvent
  } catch {
    return null
  }
}

/**
 * 发起一次 Anthropic Messages 流式请求，返回文本和完整的工具调用。
 * 对外语义与 ai.ts 的 streamChat 保持一致：增量通过 onDelta 回调，
 * 工具参数分片会拼装完整，用户中止时返回已收到的部分结果。
 */
export const streamAnthropic = async (options: StreamChatOptions): Promise<StreamChatResult> => {
  const url = anthropicMessagesUrl(options.baseUrl)
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
    const { system, messages } = toAnthropicMessages(options.messages)
    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens:
        typeof options.maxOutputTokens === 'number'
          ? options.maxOutputTokens
          : DEFAULT_ANTHROPIC_MAX_TOKENS,
      messages,
      stream: true
    }
    if (system) body.system = system
    if (options.tools && options.tools.length > 0) body.tools = toAnthropicTools(options.tools)
    if (typeof options.temperature === 'number') body.temperature = options.temperature

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': options.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
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
      const payload = (await response.json()) as WireAnthropicEvent
      applyEvent(payload, result, options.onDelta)
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
        const event = parseSseLine(line)
        if (!event) continue
        if (event.type === 'message_stop') {
          finished = true
          break
        }
        applyEvent(event, result, options.onDelta)
      }
    }

    if (!finished) {
      // 服务端直接关闭连接时，把残留的半行和未 flush 的多字节字符处理掉
      buffer += decoder.decode()
      const event = parseSseLine(buffer)
      if (event && event.type !== 'message_stop') applyEvent(event, result, options.onDelta)
    } else {
      void reader.cancel().catch(() => undefined)
    }

    return buildResult(result)
  } catch (error) {
    if (timedOut) throw new Error('AI 请求超时，请稍后重试', { cause: error })
    // 用户主动停止：把已经收到的内容当作结果返回
    if (controller.signal.aborted) return buildResult(result, 'aborted')
    if (error instanceof TypeError) {
      throw new Error('无法连接到 AI 服务，请检查 Base URL 与网络', { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
    options.signal.removeEventListener('abort', abort)
  }
}
