// 翻译宿主的主进程侧：懒启动 utilityProcess，保存翻译会话，
// 校验宿主消息，并把模型请求、流式增量和取消串起来。
// API Key 和设置始终留在主进程；宿主只收到待翻译文本和请求标识。

import { utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import type { AiRequester } from '@main/ai-request'
import { parseHostMessage, parseTranslateRequest, type HostToPlatformMessage } from './protocol'

const READY_TIMEOUT_MS = 10_000
const STOP_TIMEOUT_MS = 3000
const MAX_ERROR_LENGTH = 1000

export interface TranslationRuntimeOptions {
  /** 构建产物中翻译宿主入口的绝对路径 */
  hostScript: string
  requester: AiRequester
  onLog?: (message: string) => void
}

export interface TranslationRuntime {
  /** 启动（或复用）翻译宿主；活动栏点击时调用 */
  activate: () => Promise<void>
  translate: (sender: WebContents, request: unknown) => Promise<string>
  abort: (requestId: unknown) => void
  stop: () => Promise<void>
}

interface Session {
  requestId: string
  sender: WebContents
  profileId: string
  controller: AbortController
  /** 已收到的流式文本，中止时作为结果返回 */
  text: string
  resolve: (text: string) => void
  reject: (error: Error) => void
  onDestroyed: () => void
}

const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message
}

export const createTranslationRuntime = (
  options: TranslationRuntimeOptions
): TranslationRuntime => {
  let child: UtilityProcess | null = null
  let spawnPromise: Promise<void> | null = null
  let spawnReject: ((error: Error) => void) | null = null
  const sessions = new Map<string, Session>()

  const log = (message: string): void => options.onLog?.(message)

  const postToHost = (message: unknown): boolean => {
    if (!child) return false
    try {
      child.postMessage(message)
      return true
    } catch {
      // 宿主已退出时由 exit 事件统一处理
      return false
    }
  }

  const sendChunk = (session: Session, delta: string): void => {
    if (session.sender.isDestroyed()) return
    session.sender.send('translation:chunk', { requestId: session.requestId, delta })
  }

  const settle = (session: Session, outcome: { text: string } | { error: Error }): void => {
    if (!sessions.delete(session.requestId)) return
    session.sender.removeListener('destroyed', session.onDestroyed)
    session.controller.abort()
    if ('text' in outcome) {
      session.resolve(outcome.text)
    } else {
      session.reject(outcome.error)
    }
  }

  const failAllSessions = (message: string): void => {
    for (const session of [...sessions.values()]) {
      options.requester.abort(session.requestId)
      settle(session, { error: new Error(message) })
    }
  }

  const respond = (
    requestId: string,
    payload: { ok: true; result: unknown } | { ok: false; error: string }
  ): void => {
    postToHost({ type: 'response', requestId, ...payload })
  }

  const handleChatRequest = async (
    message: Extract<HostToPlatformMessage, { type: 'chat-request' }>
  ): Promise<void> => {
    const session = sessions.get(message.requestId)
    if (!session) {
      respond(message.requestId, { ok: false, error: '翻译请求不存在或已结束' })
      return
    }

    try {
      const result = await options.requester.chat({
        requestId: message.requestId,
        messages: message.messages,
        profileId: session.profileId,
        signal: session.controller.signal,
        onDelta: (delta) => {
          if (!sessions.has(session.requestId)) return
          session.text += delta
          sendChunk(session, delta)
        }
      })
      respond(message.requestId, { ok: true, result })
    } catch (error) {
      respond(message.requestId, { ok: false, error: describeError(error) })
    }
  }

  const handleHostMessage = (message: HostToPlatformMessage): void => {
    switch (message.type) {
      case 'ready':
      case 'stopped':
        return
      case 'chat-request':
        void handleChatRequest(message)
        return
      case 'done': {
        const session = sessions.get(message.requestId)
        if (session) settle(session, { text: message.text || session.text })
        return
      }
      case 'error': {
        const session = sessions.get(message.requestId)
        if (session) settle(session, { error: new Error(message.message) })
      }
    }
  }

  const ensureHost = (): Promise<void> => {
    if (spawnPromise) return spawnPromise
    if (child) return Promise.resolve()

    let resolveReady: () => void = () => undefined
    let rejectReady: (error: Error) => void = () => undefined
    const promise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })

    let proc: UtilityProcess
    try {
      proc = utilityProcess.fork(options.hostScript, [], { serviceName: 'reader-bai translation' })
    } catch (error) {
      rejectReady(new Error(`无法启动翻译进程：${describeError(error)}`))
      return promise
    }

    spawnPromise = promise
    spawnReject = rejectReady
    child = proc
    let ready = false

    const readyTimer = setTimeout(() => {
      if (ready || child !== proc) return
      spawnReject = null
      spawnPromise = null
      child = null
      rejectReady(new Error('翻译进程启动超时'))
      try {
        proc.kill()
      } catch {
        // 进程可能已经退出
      }
    }, READY_TIMEOUT_MS)

    const clearReadyTimer = (): void => {
      clearTimeout(readyTimer)
    }

    proc.on('message', (value) => {
      if (child !== proc) return

      let message: HostToPlatformMessage
      try {
        message = parseHostMessage(value)
      } catch (error) {
        log(`忽略非法的翻译宿主消息：${describeError(error)}`)
        return
      }

      if (!ready) {
        if (message.type !== 'ready') return
        ready = true
        clearReadyTimer()
        spawnReject = null
        resolveReady()
        return
      }

      handleHostMessage(message)
    })

    proc.once('exit', (code) => {
      if (child !== proc) return
      child = null
      spawnPromise = null
      spawnReject = null
      clearReadyTimer()

      const message = `翻译进程已退出（${code}）`
      if (!ready) {
        rejectReady(new Error(message))
        return
      }
      failAllSessions(message)
    })

    return promise
  }

  const abort = (requestId: unknown): void => {
    if (typeof requestId !== 'string' || !requestId) return
    const session = sessions.get(requestId)
    if (!session) return
    options.requester.abort(requestId)
    postToHost({ type: 'cancel', requestId })
    settle(session, { text: session.text })
  }

  const translate = async (sender: WebContents, request: unknown): Promise<string> => {
    const { requestId, source, profileId } = parseTranslateRequest(request)
    if (sessions.has(requestId)) throw new Error('请求标识重复')
    if (sender.isDestroyed()) throw new Error('窗口已关闭')

    await ensureHost()
    if (sender.isDestroyed()) throw new Error('窗口已关闭')

    return new Promise<string>((resolve, reject) => {
      const controller = new AbortController()
      const session: Session = {
        requestId,
        sender,
        profileId,
        controller,
        text: '',
        resolve,
        reject,
        onDestroyed: () => abort(requestId)
      }

      sessions.set(requestId, session)
      sender.once('destroyed', session.onDestroyed)

      if (!postToHost({ type: 'translate', requestId, source })) {
        settle(session, { error: new Error('翻译进程不可用') })
      }
    })
  }

  const stop = async (): Promise<void> => {
    for (const session of [...sessions.values()]) {
      options.requester.abort(session.requestId)
      settle(session, { text: session.text })
    }

    const pendingSpawn = spawnReject
    spawnReject = null
    pendingSpawn?.(new Error('翻译进程已停止'))

    const proc = child
    child = null
    spawnPromise = null
    if (!proc) return

    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // 进程可能已经退出
        }
        done()
      }, STOP_TIMEOUT_MS)

      proc.once('exit', done)
      try {
        proc.postMessage({ type: 'stop' })
      } catch {
        try {
          proc.kill()
        } catch {
          // 进程可能已经退出
        }
        done()
      }
    })
  }

  return {
    activate: () => ensureHost(),
    translate,
    abort,
    stop
  }
}
