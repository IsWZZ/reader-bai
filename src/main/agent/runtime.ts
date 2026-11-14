// agent 宿主的主进程侧：启动/停止 utilityProcess，创建平台 run，
// 校验宿主消息，并把模型请求、工具执行和事件转发串起来。
// API Key 和设置始终留在主进程；宿主只按会话请求能力。

import { utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { normalizeChatMessages, type ChatMessage } from '../ai'
import { startRun, type AgentRun, type RunAbortReason } from '../ai-run'
import type { AiRequester } from '../ai-request'
import type { ToolRegistry } from '../tool-registry'
import {
  AGENT_MODES,
  parseHostMessage,
  type AgentFinishReason,
  type AgentHostEvent,
  type AgentMode,
  type HostToPlatformMessage
} from './protocol'

const MAX_PROFILE_ID_LENGTH = 100
const STOP_TIMEOUT_MS = 3000
const MAX_ERROR_LENGTH = 1000

/** 运行策略由平台决定，调用方（渲染进程/模块）不能放宽 */
export const AGENT_POLICIES: Record<AgentMode, { maxSteps: number; timeoutMs: number }> = {
  chat: { maxSteps: 1, timeoutMs: 120_000 },
  agent: { maxSteps: 6, timeoutMs: 120_000 }
}

export type AgentRendererEvent =
  | { type: 'chunk'; delta: string }
  | AgentHostEvent
  | { type: 'done'; text: string; steps: number; finishReason: AgentFinishReason }
  | { type: 'error'; message: string }

export interface AgentEventPayload {
  sessionId: string
  event: AgentRendererEvent
}

export interface AgentRuntimeOptions {
  /** 构建产物中 agent 宿主入口的绝对路径 */
  hostScript: string
  requester: AiRequester
  tools: ToolRegistry
  onLog?: (message: string) => void
}

export interface AgentRuntime {
  start: (sender: WebContents, request: unknown) => Promise<{ id: string }>
  cancel: (id: unknown) => void
  stop: () => Promise<void>
}

interface Session {
  id: string
  sender: WebContents
  run: AgentRun
  mode: AgentMode
  profileId: string
  toolNames: string[]
  /** 会话级取消：中止工具执行和宿主循环 */
  controller: AbortController
  /** 宿主异常退出时的提示覆盖默认文案 */
  failureMessage?: string
  onAbort: () => void
  onDestroyed: () => void
}

const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message
}

const parseStartRequest = (
  value: unknown
): { messages: ChatMessage[]; profileId: string; mode: AgentMode } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('启动参数必须是对象')
  }
  const record = value as Record<string, unknown>

  const profileId = record.profileId
  if (typeof profileId !== 'string' || !profileId || profileId.length > MAX_PROFILE_ID_LENGTH) {
    throw new Error('请先在设置中选择 AI 服务')
  }

  const mode = record.mode
  if (typeof mode !== 'string' || !(AGENT_MODES as readonly string[]).includes(mode)) {
    throw new Error('对话模式不正确')
  }

  return {
    messages: normalizeChatMessages(record.messages),
    profileId,
    mode: mode as AgentMode
  }
}

/** 只把只读且对 AI 开放的工具交给 agent */
const readToolNames = (tools: ToolRegistry): string[] =>
  tools
    .list({ forAi: true })
    .filter((tool) => tool.risk === 'read')
    .map((tool) => tool.name)

export const createAgentRuntime = (options: AgentRuntimeOptions): AgentRuntime => {
  let child: UtilityProcess | null = null
  let spawnPromise: Promise<void> | null = null
  const sessions = new Map<string, Session>()

  const log = (message: string): void => options.onLog?.(message)

  const postToHost = (message: unknown): void => {
    if (!child) return
    try {
      child.postMessage(message)
    } catch {
      // 宿主已退出时由 exit 事件统一处理
    }
  }

  const sendEvent = (session: Session, event: AgentRendererEvent): void => {
    if (session.sender.isDestroyed()) return
    session.sender.send('agent:event', { sessionId: session.id, event } satisfies AgentEventPayload)
  }

  const cleanup = (session: Session): void => {
    if (!sessions.delete(session.id)) return
    session.run.signal.removeEventListener('abort', session.onAbort)
    session.sender.removeListener('destroyed', session.onDestroyed)
    session.controller.abort()
    session.run.dispose()
  }

  const handleAbort = (session: Session): void => {
    if (!sessions.has(session.id)) return
    const reason: RunAbortReason | null = session.run.abortReason
    if (reason === 'timeout') {
      sendEvent(session, { type: 'error', message: '运行超时，已停止' })
    } else if (reason === 'limit') {
      sendEvent(session, { type: 'error', message: '已达到运行上限，已停止' })
    } else if (reason === 'error') {
      sendEvent(session, { type: 'error', message: session.failureMessage ?? '运行出错，已停止' })
    } else {
      sendEvent(session, {
        type: 'done',
        text: '',
        steps: session.run.usage.steps,
        finishReason: 'aborted'
      })
    }

    postToHost({ type: 'cancel', sessionId: session.id })
    cleanup(session)
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
    const session = sessions.get(message.sessionId)
    if (!session) {
      respond(message.requestId, { ok: false, error: '运行不存在或已结束' })
      return
    }

    try {
      const result = await options.requester.chat({
        requestId: message.requestId,
        messages: message.messages,
        profileId: session.profileId,
        toolNames: session.toolNames,
        run: session.run,
        signal: session.controller.signal,
        onDelta: (delta) => {
          if (sessions.has(session.id)) sendEvent(session, { type: 'chunk', delta })
        }
      })
      respond(message.requestId, { ok: true, result })
    } catch (error) {
      respond(message.requestId, { ok: false, error: describeError(error) })
    }
  }

  const handleToolRequest = async (
    message: Extract<HostToPlatformMessage, { type: 'tool-request' }>
  ): Promise<void> => {
    const session = sessions.get(message.sessionId)
    if (!session) {
      respond(message.requestId, { ok: false, error: '运行不存在或已结束' })
      return
    }
    // 宿主只能调用本次运行开放的工具，不能借会话越权
    if (!session.toolNames.includes(message.name)) {
      respond(message.requestId, { ok: false, error: `工具未对本次运行开放：${message.name}` })
      return
    }

    try {
      const result = await options.tools.execute(message.name, message.input, {
        source: 'ai',
        signal: session.controller.signal,
        runId: session.id
      })
      respond(message.requestId, { ok: true, result })
    } catch (error) {
      respond(message.requestId, { ok: false, error: describeError(error) })
    }
  }

  const handleMessage = (value: unknown): void => {
    let message: HostToPlatformMessage
    try {
      message = parseHostMessage(value)
    } catch (error) {
      log(`忽略非法的 agent 宿主消息：${describeError(error)}`)
      return
    }

    switch (message.type) {
      case 'ready':
      case 'stopped':
        return
      case 'chat-request':
        void handleChatRequest(message)
        return
      case 'tool-request':
        void handleToolRequest(message)
        return
      case 'event': {
        const session = sessions.get(message.sessionId)
        if (session) sendEvent(session, message.event)
        return
      }
      case 'done': {
        const session = sessions.get(message.sessionId)
        if (!session) return
        sendEvent(session, {
          type: 'done',
          text: message.result.text,
          steps: message.result.steps,
          finishReason: message.result.finishReason
        })
        cleanup(session)
        return
      }
      case 'error': {
        const session = sessions.get(message.sessionId)
        if (!session) return
        sendEvent(session, { type: 'error', message: message.message })
        cleanup(session)
      }
    }
  }

  const failAllSessions = (message: string): void => {
    for (const session of [...sessions.values()]) {
      session.failureMessage = message
      session.run.cancel('error')
    }
  }

  const ensureHost = (): Promise<void> => {
    if (child) return Promise.resolve()
    if (spawnPromise) return spawnPromise

    let resolveSpawn: () => void = () => undefined
    let rejectSpawn: (error: Error) => void = () => undefined
    const promise = new Promise<void>((resolve, reject) => {
      resolveSpawn = resolve
      rejectSpawn = reject
    })

    let proc: UtilityProcess
    try {
      proc = utilityProcess.fork(options.hostScript, [], { serviceName: 'reader-bai agent' })
    } catch (error) {
      const message = `无法启动 agent 宿主：${describeError(error)}`
      rejectSpawn(new Error(message))
      return promise
    }

    spawnPromise = promise
    let spawned = false
    child = proc

    proc.on('message', (message) => {
      if (child === proc) handleMessage(message)
    })
    proc.once('spawn', () => {
      if (child !== proc) return
      spawned = true
      resolveSpawn()
    })
    proc.once('exit', (code) => {
      if (child !== proc) return
      child = null
      spawnPromise = null
      const message = `agent 宿主已退出（${code}）`
      if (!spawned) {
        rejectSpawn(new Error(message))
        return
      }
      failAllSessions(message)
    })

    return promise
  }

  const start = async (sender: WebContents, request: unknown): Promise<{ id: string }> => {
    const { messages, profileId, mode } = parseStartRequest(request)
    await ensureHost()

    const policy = AGENT_POLICIES[mode]
    const run = startRun({ maxSteps: policy.maxSteps, timeoutMs: policy.timeoutMs })
    const toolNames = mode === 'agent' ? readToolNames(options.tools) : []
    const controller = new AbortController()

    const session: Session = {
      id: run.id,
      sender,
      run,
      mode,
      profileId,
      toolNames,
      controller,
      onAbort: () => handleAbort(session),
      onDestroyed: () => run.cancel('user')
    }

    run.signal.addEventListener('abort', session.onAbort, { once: true })
    sender.once('destroyed', session.onDestroyed)
    sessions.set(run.id, session)

    postToHost({
      type: 'start',
      sessionId: run.id,
      mode,
      messages,
      toolNames,
      maxSteps: policy.maxSteps
    })

    return { id: run.id }
  }

  const cancel = (id: unknown): void => {
    if (typeof id !== 'string' || !id) return
    sessions.get(id)?.run.cancel('user')
  }

  const stop = async (): Promise<void> => {
    for (const session of [...sessions.values()]) session.run.cancel('user')

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

  return { start, cancel, stop }
}
