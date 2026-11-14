// agent 宿主入口：由主进程用 utilityProcess 启动的独立进程。
// agent loop 在这里运行；它不能访问 API Key、设置、文件系统或窗口，
// 只能通过 parentPort 请求主进程完成模型调用和工具执行。

import { randomUUID } from 'crypto'
import type { ChatMessage, StreamChatResult } from '../ai'
import type { ToolResult } from '../tool-registry'
import { runAgentLoop } from './loop'
import { parseStartMessage, type AgentHostEvent, type PlatformToHostMessage } from './protocol'

interface ParentPortLike {
  on: (event: 'message', listener: (event: { data: unknown }) => void) => void
  postMessage: (message: unknown) => void
}

type MessageSink = (message: unknown) => void

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort

const PLATFORM_TIMEOUT_MS = 10 * 60_000
const MAX_PENDING_REQUESTS = 50
const MAX_ERROR_LENGTH = 1000
const KEEP_ALIVE_MS = 60_000

const AGENT_SYSTEM_PROMPT =
  '你是一个简洁、准确的学术阅读助手，请用中文回答用户的问题。你可以调用平台工具查询论文库和标注；涉及论文标题、标注内容时先查工具，不要编造。'

const CHAT_SYSTEM_PROMPT = '你是一个简洁、准确的学术阅读助手，请用中文回答用户的问题。'

const send: MessageSink = (message) => {
  try {
    parentPort?.postMessage(message)
  } catch {
    // 宿主正在退出时发送失败可以忽略
  }
}

const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingRequest>()
const sessions = new Map<string, AbortController>()

/** 向主进程发起一次请求；响应按 requestId 回来 */
const callPlatform = <T>(message: Record<string, unknown>): Promise<T> => {
  if (!parentPort) return Promise.reject(new Error('agent 宿主未连接到平台'))
  if (pending.size >= MAX_PENDING_REQUESTS) {
    return Promise.reject(new Error('待处理的平台请求过多'))
  }

  const requestId = typeof message.requestId === 'string' ? message.requestId : randomUUID()

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('平台请求超时'))
    }, PLATFORM_TIMEOUT_MS)
    pending.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      timer
    })
    send({ ...message, requestId })
  })
}

const settleRequest = (message: Extract<PlatformToHostMessage, { type: 'response' }>): void => {
  const request = pending.get(message.requestId)
  if (!request) return
  pending.delete(message.requestId)
  clearTimeout(request.timer)
  if (message.ok) {
    request.resolve(message.result)
  } else {
    request.reject(new Error(message.error ?? '平台请求失败'))
  }
}

const requestChat = (
  sessionId: string,
  requestId: string,
  messages: ChatMessage[]
): Promise<StreamChatResult> =>
  callPlatform<StreamChatResult>({
    type: 'chat-request',
    requestId,
    sessionId,
    messages
  })

const requestTool = (sessionId: string, name: string, input: unknown): Promise<ToolResult> =>
  callPlatform<ToolResult>({
    type: 'tool-request',
    requestId: randomUUID(),
    sessionId,
    name,
    input
  })

/** 只把 UI 需要的循环事件转给主进程；模型增量由主进程直接推送 */
const forwardEvent = (sessionId: string, event: AgentHostEvent): void => {
  send({ type: 'event', sessionId, event })
}

const startSession = (value: unknown): void => {
  let start
  try {
    start = parseStartMessage(value)
  } catch (error) {
    // 主进程会先校验再发消息；走到这里说明平台自身发送了非法数据
    console.error(`[agent] 忽略非法的启动消息：${describeError(error)}`)
    return
  }

  const { sessionId, messages, toolNames, maxSteps } = start
  const controller = new AbortController()
  sessions.set(sessionId, controller)

  const withSystemPrompt: ChatMessage[] = [
    {
      role: 'system',
      content: toolNames.length > 0 ? AGENT_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT
    },
    ...messages
  ]

  void (async () => {
    try {
      const result = await runAgentLoop({
        messages: withSystemPrompt,
        toolNames,
        signal: controller.signal,
        maxSteps,
        createRequestId: () => randomUUID(),
        chat: (requestId, loopMessages) => requestChat(sessionId, requestId, loopMessages),
        executeTool: (name, input) => requestTool(sessionId, name, input),
        onEvent: (event) => {
          if (event.type === 'tool-call') {
            forwardEvent(sessionId, {
              type: 'tool-call',
              callId: event.callId,
              name: event.name
            })
          } else if (event.type === 'tool-result') {
            forwardEvent(sessionId, {
              type: 'tool-result',
              callId: event.callId,
              name: event.name,
              content: event.result.content
            })
          } else if (event.type === 'tool-error') {
            forwardEvent(sessionId, {
              type: 'tool-error',
              callId: event.callId,
              name: event.name,
              error: event.error
            })
          }
        }
      })
      send({
        type: 'done',
        sessionId,
        result: { text: result.text, steps: result.steps, finishReason: result.finishReason }
      })
    } catch (error) {
      send({ type: 'error', sessionId, message: describeError(error) })
    } finally {
      sessions.delete(sessionId)
    }
  })()
}

const cancelSession = (sessionId: string): void => {
  sessions.get(sessionId)?.abort()
}

const shutdown = (): void => {
  for (const controller of sessions.values()) controller.abort()
  sessions.clear()
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(new Error('agent 宿主已停止'))
  }
  pending.clear()
  send({ type: 'stopped' })
  setImmediate(() => process.exit(0))
}

const handleMessage = (value: unknown): void => {
  if (!value || typeof value !== 'object') return
  const message = value as PlatformToHostMessage
  if (message.type === 'start') {
    startSession(message)
  } else if (message.type === 'response') {
    settleRequest(message)
  } else if (message.type === 'cancel') {
    cancelSession(message.sessionId)
  } else if (message.type === 'stop') {
    shutdown()
  }
}

// 保持进程存活，等待平台请求；退出由 stop 消息或父进程结束触发
setInterval(() => undefined, KEEP_ALIVE_MS)

if (parentPort) {
  parentPort.on('message', (event) => handleMessage(event.data))
  send({ type: 'ready' })
}
