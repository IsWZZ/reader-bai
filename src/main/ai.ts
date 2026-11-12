// OpenAI 兼容的流式对话实现。
// 这里刻意不依赖 electron，方便在 Vitest 中直接对解析逻辑做单元测试。

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface StreamChatOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  signal: AbortSignal
  /** 每收到一段增量就回调一次 */
  onDelta: (delta: string) => void
}

const MAX_MESSAGES = 40
const MAX_TOTAL_CHARS = 40000
const MAX_ERROR_BODY = 500
const REQUEST_TIMEOUT_MS = 60_000

const ROLES = new Set<ChatRole>(['system', 'user', 'assistant'])

interface ChatCompletionChunk {
  choices?: {
    delta?: { content?: string }
    message?: { content?: string }
  }[]
}

/** Base URL 统一补上 /chat/completions；已经写全的地址保持原样 */
export const chatCompletionsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`
}

/** 校验来自渲染进程的消息，并把它们转成普通对象（结构化克隆前的防线） */
export const normalizeChatMessages = (input: unknown): ChatMessage[] => {
  if (!Array.isArray(input)) throw new Error('消息格式不正确')
  if (input.length === 0) throw new Error('消息不能为空')
  if (input.length > MAX_MESSAGES) throw new Error(`消息数量不能超过 ${MAX_MESSAGES} 条`)

  let total = 0
  const messages = input.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('消息格式不正确')
    const item = raw as Partial<ChatMessage>
    if (!item.role || !ROLES.has(item.role) || typeof item.content !== 'string') {
      throw new Error('消息格式不正确')
    }
    total += item.content.length
    return { role: item.role, content: item.content }
  })

  if (total > MAX_TOTAL_CHARS) throw new Error('消息过长')
  return messages
}

const DONE = Symbol('done')

/** 解析一条 SSE data 行：返回增量文本、结束标记或 null（忽略） */
const parseSseLine = (line: string): string | typeof DONE | null => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return null

  const payload = trimmed.slice('data:'.length).trim()
  if (payload === '[DONE]') return DONE

  try {
    const parsed = JSON.parse(payload) as ChatCompletionChunk
    const delta = parsed.choices?.[0]?.delta?.content
    return typeof delta === 'string' && delta ? delta : null
  } catch {
    // 非 JSON 的心跳/注释行直接跳过
    return null
  }
}

/** 非流式响应（部分服务忽略 stream 参数）时取完整内容 */
const readJsonContent = (payload: ChatCompletionChunk): string => {
  const content = payload.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

export const streamChatCompletion = async (options: StreamChatOptions): Promise<string> => {
  const url = chatCompletionsUrl(options.baseUrl)
  if (!url) throw new Error('AI 服务地址未配置')

  const controller = new AbortController()
  let timedOut = false
  let text = ''

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
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`AI 服务返回 ${response.status}: ${body.slice(0, MAX_ERROR_BODY)}`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream') || !response.body) {
      const payload = (await response.json()) as ChatCompletionChunk
      text = readJsonContent(payload)
      if (text) options.onDelta(text)
      return text
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
        const delta = parseSseLine(line)
        if (delta === null) continue
        if (delta === DONE) {
          finished = true
          break
        }
        text += delta
        options.onDelta(delta)
      }
    }

    if (!finished) {
      // 响应结束时把残留的半行和未 flush 的多字节字符一起处理掉
      buffer += decoder.decode()
      const delta = parseSseLine(buffer)
      if (delta !== null && delta !== DONE) {
        text += delta
        options.onDelta(delta)
      }
    } else {
      void reader.cancel().catch(() => undefined)
    }

    return text
  } catch (error) {
    if (timedOut) throw new Error('AI 请求超时，请稍后重试', { cause: error })
    // 用户主动停止：把已经收到的内容当作结果返回
    if (controller.signal.aborted) return text
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
