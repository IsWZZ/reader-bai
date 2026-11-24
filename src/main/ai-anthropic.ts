// Anthropic Messages API 的流式文本实现。
// 与 ai.ts 一样刻意不依赖 electron，方便在 Vitest 中直接测试协议转换和 SSE 解析。
// 对外仍然使用 OpenAI 风格的 ChatMessage，转换只发生在这一层。

import type { ChatFinishReason, ChatMessage, StreamChatOptions, StreamChatResult } from './ai'

export const ANTHROPIC_VERSION = '2023-06-01'
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096

const MAX_ERROR_BODY = 500
const REQUEST_TIMEOUT_MS = 60_000

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
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

/**
 * 把内部的 OpenAI 风格消息转成 Anthropic Messages：
 * - system 消息提升为顶层 system 字段
 * - Anthropic 要求角色交替，因此相邻同角色消息会合并
 */
export const toAnthropicMessages = (
  messages: ChatMessage[]
): { system?: string; messages: AnthropicMessage[] } => {
  const system: string[] = []
  const converted: AnthropicMessage[] = []

  const push = (role: 'user' | 'assistant', text: string): void => {
    if (!text) return
    const last = converted[converted.length - 1]
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${text}`
      return
    }
    converted.push({ role, content: text })
  }

  for (const message of messages) {
    if (message.role === 'system') {
      const text = message.content.trim()
      if (text) system.push(text)
      continue
    }
    push(message.role, message.content)
  }

  return system.length > 0
    ? { system: system.join('\n\n'), messages: converted }
    : { messages: converted }
}

interface WireContentBlock {
  type?: string
  text?: string
}

interface WireAnthropicEvent {
  type?: string
  content_block?: WireContentBlock
  delta?: {
    type?: string
    text?: string
    stop_reason?: string | null
  }
  message?: { stop_reason?: string | null }
  stop_reason?: string | null
  content?: WireContentBlock[]
  error?: { type?: string; message?: string }
}

interface MutableStreamResult {
  text: string
  finishReason: ChatFinishReason
}

const normalizeStopReason = (reason: string | null | undefined): ChatFinishReason => {
  if (reason === 'max_tokens') return 'length'
  return 'stop'
}

const applyContentBlocks = (
  blocks: WireContentBlock[],
  result: MutableStreamResult,
  onDelta: (delta: string) => void
): void => {
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      result.text += block.text
      onDelta(block.text)
    }
  }
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
    if (block?.type === 'text' && typeof block.text === 'string' && block.text) {
      result.text += block.text
      onDelta(block.text)
    }
    return
  }

  if (event.type === 'content_block_delta') {
    const delta = event.delta
    if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
      result.text += delta.text
      onDelta(delta.text)
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

const buildResult = (
  result: MutableStreamResult,
  forcedReason?: ChatFinishReason
): StreamChatResult => ({
  text: result.text,
  finishReason: forcedReason ?? result.finishReason
})

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
 * 发起一次 Anthropic Messages 流式请求，返回文本。
 * 对外语义与 ai.ts 的 streamChat 保持一致：增量通过 onDelta 回调，
 * 用户中止时返回已收到的部分结果。
 */
export const streamAnthropic = async (options: StreamChatOptions): Promise<StreamChatResult> => {
  const url = anthropicMessagesUrl(options.baseUrl)
  if (!url) throw new Error('AI 服务地址未配置')

  const controller = new AbortController()
  let timedOut = false
  const result: MutableStreamResult = { text: '', finishReason: 'stop' }

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
