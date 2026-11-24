// 翻译宿主入口：由主进程用 utilityProcess 启动的独立进程。
// 它只负责构造翻译消息和请求平台调用模型，不能访问 API Key、设置、
// 文件系统或窗口；模型请求和 Key 的使用始终留在主进程。

import type { StreamChatResult } from '@main/ai'
import { buildTranslationMessages } from './prompt'
import { parsePlatformMessage, type PlatformToHostMessage } from './protocol'

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
/** 每个翻译请求一个取消控制器；主进程发 cancel 时中止对应请求。 */
const sessions = new Map<string, AbortController>()

const callPlatform = <T>(message: Record<string, unknown>): Promise<T> => {
  if (!parentPort) return Promise.reject(new Error('翻译宿主未连接到平台'))
  if (pending.size >= MAX_PENDING_REQUESTS) {
    return Promise.reject(new Error('待处理的平台请求过多'))
  }

  const requestId = typeof message.requestId === 'string' ? message.requestId : ''
  if (!requestId) return Promise.reject(new Error('平台请求缺少标识'))

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

const handleTranslate = (message: Extract<PlatformToHostMessage, { type: 'translate' }>): void => {
  const { requestId, source } = message
  if (sessions.has(requestId)) {
    send({ type: 'error', requestId, message: '翻译请求标识重复' })
    return
  }

  const controller = new AbortController()
  sessions.set(requestId, controller)

  void (async () => {
    try {
      const result = await callPlatform<StreamChatResult>({
        type: 'chat-request',
        requestId,
        messages: buildTranslationMessages(source)
      })
      if (!sessions.has(requestId)) return
      send({ type: 'done', requestId, text: result.text })
    } catch (error) {
      if (!sessions.has(requestId)) return
      send({ type: 'error', requestId, message: describeError(error) })
    } finally {
      sessions.delete(requestId)
    }
  })()
}

const cancelTranslation = (requestId: string): void => {
  const controller = sessions.get(requestId)
  if (!controller) return
  controller.abort()
  sessions.delete(requestId)
}

const shutdown = (): void => {
  for (const controller of sessions.values()) controller.abort()
  sessions.clear()
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(new Error('翻译宿主已停止'))
  }
  pending.clear()
  send({ type: 'stopped' })
  setImmediate(() => process.exit(0))
}

const handleMessage = (value: unknown): void => {
  let message: PlatformToHostMessage
  try {
    message = parsePlatformMessage(value)
  } catch (error) {
    console.error(`[translation] 忽略非法的平台消息：${describeError(error)}`)
    return
  }

  switch (message.type) {
    case 'translate':
      handleTranslate(message)
      return
    case 'response':
      settleRequest(message)
      return
    case 'cancel':
      cancelTranslation(message.requestId)
      return
    case 'stop':
      shutdown()
  }
}

// 保持进程存活，等待平台请求；退出由 stop 消息或父进程结束触发
setInterval(() => undefined, KEEP_ALIVE_MS)

if (parentPort) {
  parentPort.on('message', (event) => handleMessage(event.data))
  send({ type: 'ready' })
}
