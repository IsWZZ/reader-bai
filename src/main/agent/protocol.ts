// 主进程与 agent 宿主之间的消息协议。
// agent 宿主是独立 utilityProcess：它只能请求模型调用和工具执行，
// 拿不到 API Key、设置、文件系统或窗口。主进程对每条消息重新校验。

import type { ChatMessage } from '../ai'

export const AGENT_MODES = ['chat', 'agent'] as const
export type AgentMode = (typeof AGENT_MODES)[number]

export type AgentFinishReason = 'stop' | 'max-steps' | 'aborted'

/** 宿主上报的循环事件；模型增量由主进程直接推给渲染进程，不经过这里 */
export type AgentHostEvent =
  | { type: 'tool-call'; callId: string; name: string }
  | { type: 'tool-result'; callId: string; name: string; content: string }
  | { type: 'tool-error'; callId: string; name: string; error: string }

export interface AgentRunSummary {
  text: string
  steps: number
  finishReason: AgentFinishReason
}

export type HostToPlatformMessage =
  | { type: 'ready' }
  | { type: 'stopped' }
  | { type: 'chat-request'; requestId: string; sessionId: string; messages: unknown }
  | { type: 'tool-request'; requestId: string; sessionId: string; name: string; input: unknown }
  | { type: 'event'; sessionId: string; event: AgentHostEvent }
  | { type: 'done'; sessionId: string; result: AgentRunSummary }
  | { type: 'error'; sessionId: string; message: string }

export type PlatformToHostMessage =
  | {
      type: 'start'
      sessionId: string
      mode: AgentMode
      messages: ChatMessage[]
      toolNames: string[]
      maxSteps: number
    }
  | {
      type: 'response'
      requestId: string
      ok: boolean
      result?: unknown
      error?: string
    }
  | { type: 'cancel'; sessionId: string }
  | { type: 'stop' }

const MAX_ID_LENGTH = 100
const MAX_NAME_LENGTH = 100
const MAX_ERROR_LENGTH = 2000
const MAX_TEXT_CHARS = 100_000
const MAX_MESSAGES_CHARS = 200_000
const MAX_INPUT_CHARS = 100_000
const MAX_STEPS = 100

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`)
  }
  return value as Record<string, unknown>
}

const readString = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}必须是非空字符串`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new Error(`${label}过长`)
  return trimmed
}

const assertSerializable = (value: unknown, label: string, maxChars: number): void => {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new Error(`${label}无法序列化`, { cause: error })
  }
  if (serialized === undefined) throw new Error(`${label}无法序列化`)
  if (serialized.length > maxChars) throw new Error(`${label}过大`)
}

const isAgentMode = (value: unknown): value is AgentMode =>
  typeof value === 'string' && (AGENT_MODES as readonly string[]).includes(value)

const isFinishReason = (value: unknown): value is AgentFinishReason =>
  value === 'stop' || value === 'max-steps' || value === 'aborted'

const parseEvent = (value: unknown): AgentHostEvent => {
  const record = asRecord(value, 'agent 事件')
  switch (record.type) {
    case 'tool-call':
      return {
        type: 'tool-call',
        callId: readString(record.callId, '调用 id', MAX_ID_LENGTH),
        name: readString(record.name, '工具名称', MAX_NAME_LENGTH)
      }
    case 'tool-result':
      return {
        type: 'tool-result',
        callId: readString(record.callId, '调用 id', MAX_ID_LENGTH),
        name: readString(record.name, '工具名称', MAX_NAME_LENGTH),
        content: readString(record.content, '工具结果', MAX_TEXT_CHARS)
      }
    case 'tool-error':
      return {
        type: 'tool-error',
        callId: readString(record.callId, '调用 id', MAX_ID_LENGTH),
        name: readString(record.name, '工具名称', MAX_NAME_LENGTH),
        error: readString(record.error, '错误信息', MAX_ERROR_LENGTH)
      }
    default:
      throw new Error('未知的 agent 事件')
  }
}

/** 校验 agent 宿主发来的消息；不认识的类型直接拒绝 */
export const parseHostMessage = (value: unknown): HostToPlatformMessage => {
  const record = asRecord(value, 'agent 宿主消息')
  switch (record.type) {
    case 'ready':
      return { type: 'ready' }
    case 'stopped':
      return { type: 'stopped' }
    case 'chat-request': {
      assertSerializable(record.messages, '对话消息', MAX_MESSAGES_CHARS)
      return {
        type: 'chat-request',
        requestId: readString(record.requestId, '请求 id', MAX_ID_LENGTH),
        sessionId: readString(record.sessionId, '会话 id', MAX_ID_LENGTH),
        messages: record.messages
      }
    }
    case 'tool-request': {
      if (record.input !== undefined) {
        assertSerializable(record.input, '工具参数', MAX_INPUT_CHARS)
      }
      return {
        type: 'tool-request',
        requestId: readString(record.requestId, '请求 id', MAX_ID_LENGTH),
        sessionId: readString(record.sessionId, '会话 id', MAX_ID_LENGTH),
        name: readString(record.name, '工具名称', MAX_NAME_LENGTH),
        input: record.input
      }
    }
    case 'event':
      return {
        type: 'event',
        sessionId: readString(record.sessionId, '会话 id', MAX_ID_LENGTH),
        event: parseEvent(record.event)
      }
    case 'done': {
      const result = asRecord(record.result, '运行结果')
      const steps = result.steps
      if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 0 || steps > MAX_STEPS) {
        throw new Error('运行步数不正确')
      }
      if (!isFinishReason(result.finishReason)) throw new Error('结束原因不正确')
      if (typeof result.text !== 'string' || result.text.length > MAX_TEXT_CHARS) {
        throw new Error('运行结果文本不正确')
      }
      return {
        type: 'done',
        sessionId: readString(record.sessionId, '会话 id', MAX_ID_LENGTH),
        result: { text: result.text, steps, finishReason: result.finishReason }
      }
    }
    case 'error':
      return {
        type: 'error',
        sessionId: readString(record.sessionId, '会话 id', MAX_ID_LENGTH),
        message: readString(record.message, '错误信息', MAX_ERROR_LENGTH)
      }
    default:
      throw new Error('未知的 agent 宿主消息')
  }
}

/** 宿主侧校验平台发来的启动消息（主进程是受信任的，仍做一次防御性检查） */
export interface StartSessionMessage {
  sessionId: string
  mode: AgentMode
  messages: ChatMessage[]
  toolNames: string[]
  maxSteps: number
}

export const parseStartMessage = (value: unknown): StartSessionMessage => {
  const record = asRecord(value, '启动消息')
  const sessionId = readString(record.sessionId, '会话 id', MAX_ID_LENGTH)
  if (!isAgentMode(record.mode)) throw new Error('agent 模式不正确')
  if (!Array.isArray(record.messages)) throw new Error('对话消息必须是数组')
  if (record.messages.length > 40) throw new Error('对话消息数量超过允许值')
  if (!Array.isArray(record.toolNames)) throw new Error('工具列表必须是数组')
  if (record.toolNames.length > 50) throw new Error('工具数量超过允许值')

  const toolNames = record.toolNames.map((item) => readString(item, '工具名称', MAX_NAME_LENGTH))
  const maxSteps = record.maxSteps
  if (
    typeof maxSteps !== 'number' ||
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > MAX_STEPS
  ) {
    throw new Error('步数上限不正确')
  }

  return {
    sessionId,
    mode: record.mode,
    messages: record.messages as ChatMessage[],
    toolNames,
    maxSteps
  }
}
