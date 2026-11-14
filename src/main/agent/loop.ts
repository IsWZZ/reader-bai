// 第一方 agent 循环：模型 → 工具 → 模型。
// 它运行在独立的 utilityProcess 里（见 host-process.ts），主进程只按请求
// 提供模型访问和工具执行；循环本身不接触 Key、设置、文件系统或窗口。
// 这个模块保持纯逻辑，便于直接做单元测试。

import type { ChatMessage, ChatToolCallResult, StreamChatResult } from '../ai'
import type { ToolResult } from '../tool-registry'

export interface AgentToolCallEvent {
  callId: string
  name: string
  input: unknown
}

export type AgentEvent =
  | { type: 'assistant-message'; content: string; toolCalls: ChatToolCallResult[] }
  | ({ type: 'tool-call' } & AgentToolCallEvent)
  | { type: 'tool-result'; callId: string; name: string; result: ToolResult }
  | { type: 'tool-error'; callId: string; name: string; error: string }

export type AgentFinishReason = 'stop' | 'max-steps' | 'aborted'

export interface AgentRunResult {
  messages: ChatMessage[]
  text: string
  steps: number
  finishReason: AgentFinishReason
}

export interface AgentLoopOptions {
  messages: ChatMessage[]
  /** 只传工具名，真正的 schema 由主进程注册表解析 */
  toolNames: string[]
  signal: AbortSignal
  /** 发起一次模型请求，返回文本和工具调用 */
  chat: (
    requestId: string,
    messages: ChatMessage[],
    signal: AbortSignal
  ) => Promise<StreamChatResult>
  /** 通过平台执行边界调用工具，写操作会在那里确认 */
  executeTool: (name: string, input: unknown) => Promise<ToolResult>
  createRequestId: () => string
  maxSteps?: number
  onEvent?: (event: AgentEvent) => void
}

const DEFAULT_MAX_STEPS = 8
const HARD_MAX_STEPS = 20

const parseArguments = (raw: string): unknown => {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  return JSON.parse(trimmed) as unknown
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const abortResult = (messages: ChatMessage[], text: string, steps: number): AgentRunResult => ({
  messages,
  text,
  steps,
  finishReason: 'aborted'
})

/**
 * 运行 agent loop：模型 → 工具 → 模型，直到不再有工具调用、被取消或达到步数上限。
 * 平台不参与循环，只按会话提供每次模型请求和工具执行。
 */
export const runAgentLoop = async (options: AgentLoopOptions): Promise<AgentRunResult> => {
  const { signal } = options
  const messages: ChatMessage[] = [...options.messages]
  const maxSteps = Math.max(1, Math.min(options.maxSteps ?? DEFAULT_MAX_STEPS, HARD_MAX_STEPS))
  const emit = (event: AgentEvent): void => options.onEvent?.(event)

  let lastText = ''

  for (let step = 0; step < maxSteps; step += 1) {
    if (signal.aborted) return abortResult(messages, lastText, step)

    const result = await options.chat(options.createRequestId(), messages, signal)
    if (signal.aborted || result.finishReason === 'aborted') {
      return abortResult(messages, result.text || lastText, step + 1)
    }

    if (result.text) lastText = result.text
    emit({ type: 'assistant-message', content: result.text, toolCalls: result.toolCalls })

    if (result.toolCalls.length === 0) {
      return {
        messages,
        text: result.text,
        steps: step + 1,
        finishReason: 'stop'
      }
    }

    messages.push({
      role: 'assistant',
      content: result.text || null,
      tool_calls: result.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments }
      }))
    })

    for (const call of result.toolCalls) {
      if (signal.aborted) return abortResult(messages, lastText, step + 1)

      let input: unknown
      try {
        input = parseArguments(call.arguments)
      } catch {
        const message = '工具参数不是合法的 JSON'
        emit({ type: 'tool-error', callId: call.id, name: call.name, error: message })
        messages.push({ role: 'tool', tool_call_id: call.id, content: message })
        continue
      }

      emit({ type: 'tool-call', callId: call.id, name: call.name, input })

      try {
        const toolResult = await options.executeTool(call.name, input)
        emit({ type: 'tool-result', callId: call.id, name: call.name, result: toolResult })
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult.content })
      } catch (error) {
        const message = errorMessage(error)
        emit({ type: 'tool-error', callId: call.id, name: call.name, error: message })
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `工具执行失败：${message}`
        })
      }
    }
  }

  return { messages, text: lastText, steps: maxSteps, finishReason: 'max-steps' }
}
