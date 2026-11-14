import { describe, expect, it, vi, type Mock } from 'vitest'
import { runAgentLoop, type AgentEvent, type AgentLoopOptions } from '@renderer/lib/agent-loop'
import type { AiChatResult, ChatToolCallResult } from '@renderer/types'

type ChatFn = AgentLoopOptions['chat']
type ExecuteFn = AgentLoopOptions['executeTool']

interface TestOptions extends AgentLoopOptions {
  chat: Mock<ChatFn>
  executeTool: Mock<ExecuteFn>
}

const aiResult = (overrides: Partial<AiChatResult> = {}): AiChatResult => ({
  text: '',
  toolCalls: [],
  finishReason: 'stop',
  ...overrides
})

const toolCall = (id: string, name: string, args = '{}'): ChatToolCallResult => ({
  id,
  name,
  arguments: args
})

const setup = (overrides: Partial<AgentLoopOptions> = {}): TestOptions => {
  let request = 0
  return {
    messages: [{ role: 'user', content: 'hi' }],
    toolNames: ['library.list'],
    signal: new AbortController().signal,
    chat: vi.fn<ChatFn>(async () => aiResult()),
    executeTool: vi.fn<ExecuteFn>(async () => ({ content: 'ok' })),
    createRequestId: () => `req-${(request += 1)}`,
    ...overrides
  } as TestOptions
}

describe('runAgentLoop', () => {
  it('stops after a text-only reply', async () => {
    const options = setup()
    options.chat.mockResolvedValue(aiResult({ text: '你好' }))

    const result = await runAgentLoop(options)

    expect(result).toMatchObject({ text: '你好', steps: 1, finishReason: 'stop' })
    expect(options.chat).toHaveBeenCalledTimes(1)
    expect(options.executeTool).not.toHaveBeenCalled()
  })

  it('executes a tool call and feeds the result back to the model', async () => {
    const options = setup()
    const events: AgentEvent[] = []
    options.onEvent = (event) => events.push(event)
    options.chat
      .mockResolvedValueOnce(
        aiResult({
          toolCalls: [toolCall('call-1', 'library.list', '{"query":"attention"}')],
          finishReason: 'tool_calls'
        })
      )
      .mockResolvedValueOnce(aiResult({ text: '找到 1 篇' }))
    options.executeTool.mockResolvedValue({ content: '{"total":1}' })

    const result = await runAgentLoop(options)

    expect(result).toMatchObject({ text: '找到 1 篇', steps: 2, finishReason: 'stop' })
    expect(options.executeTool).toHaveBeenCalledWith('library.list', { query: 'attention' })
    expect(options.chat.mock.calls[1][1]).toEqual([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'library.list', arguments: '{"query":"attention"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call-1', content: '{"total":1}' }
    ])
    expect(events.map((event) => event.type)).toEqual([
      'assistant-message',
      'tool-call',
      'tool-result',
      'assistant-message'
    ])
  })

  it('runs multiple tool calls in order', async () => {
    const options = setup()
    options.chat
      .mockResolvedValueOnce(
        aiResult({
          toolCalls: [
            toolCall('call-1', 'library.list', '{"query":"a"}'),
            toolCall('call-2', 'annotations.list', '{"paperId":"p1"}')
          ],
          finishReason: 'tool_calls'
        })
      )
      .mockResolvedValueOnce(aiResult({ text: '完成' }))
    options.executeTool
      .mockResolvedValueOnce({ content: 'first' })
      .mockResolvedValueOnce({ content: 'second' })

    await runAgentLoop(options)

    expect(options.executeTool.mock.calls.map(([name]) => name)).toEqual([
      'library.list',
      'annotations.list'
    ])
    const messages = options.chat.mock.calls[1][1]
    expect(messages.slice(-2)).toEqual([
      { role: 'tool', tool_call_id: 'call-1', content: 'first' },
      { role: 'tool', tool_call_id: 'call-2', content: 'second' }
    ])
  })

  it('treats empty arguments as an empty object', async () => {
    const options = setup()
    options.chat
      .mockResolvedValueOnce(
        aiResult({
          toolCalls: [toolCall('call-1', 'library.list', '')],
          finishReason: 'tool_calls'
        })
      )
      .mockResolvedValueOnce(aiResult({ text: '完成' }))

    await runAgentLoop(options)

    expect(options.executeTool).toHaveBeenCalledWith('library.list', {})
  })

  it('feeds invalid JSON back without executing the tool', async () => {
    const options = setup()
    options.chat
      .mockResolvedValueOnce(
        aiResult({
          toolCalls: [toolCall('call-1', 'library.list', 'not json')],
          finishReason: 'tool_calls'
        })
      )
      .mockResolvedValueOnce(aiResult({ text: '参数有误' }))

    const result = await runAgentLoop(options)

    expect(result.text).toBe('参数有误')
    expect(options.executeTool).not.toHaveBeenCalled()
    expect(options.chat.mock.calls[1][1].slice(-1)).toEqual([
      { role: 'tool', tool_call_id: 'call-1', content: '工具参数不是合法的 JSON' }
    ])
  })

  it('feeds tool execution errors back to the model', async () => {
    const options = setup()
    const events: AgentEvent[] = []
    options.onEvent = (event) => events.push(event)
    options.chat
      .mockResolvedValueOnce(
        aiResult({
          toolCalls: [toolCall('call-1', 'annotations.remove')],
          finishReason: 'tool_calls'
        })
      )
      .mockResolvedValueOnce(aiResult({ text: '没有权限' }))
    options.executeTool.mockRejectedValue(new Error('没有权限执行该工具：annotations.remove'))

    const result = await runAgentLoop(options)

    expect(result.finishReason).toBe('stop')
    expect(options.chat.mock.calls[1][1].slice(-1)).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: '工具执行失败：没有权限执行该工具：annotations.remove'
      }
    ])
    expect(events).toContainEqual({
      type: 'tool-error',
      callId: 'call-1',
      name: 'annotations.remove',
      error: '没有权限执行该工具：annotations.remove'
    })
  })

  it('stops when the step budget is exhausted', async () => {
    const options = setup({ maxSteps: 2 })
    options.chat.mockResolvedValue(
      aiResult({
        toolCalls: [toolCall('call-1', 'library.list')],
        finishReason: 'tool_calls'
      })
    )

    const result = await runAgentLoop(options)

    expect(result).toMatchObject({ steps: 2, finishReason: 'max-steps' })
    expect(options.chat).toHaveBeenCalledTimes(2)
    expect(options.executeTool).toHaveBeenCalledTimes(2)
  })

  it('does not call the model when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const options = setup({ signal: controller.signal })

    const result = await runAgentLoop(options)

    expect(result.finishReason).toBe('aborted')
    expect(options.chat).not.toHaveBeenCalled()
  })

  it('returns the partial text when the model request is aborted', async () => {
    const options = setup()
    options.chat.mockResolvedValue(aiResult({ text: '部分回复', finishReason: 'aborted' }))

    const result = await runAgentLoop(options)

    expect(result).toMatchObject({ text: '部分回复', steps: 1, finishReason: 'aborted' })
    expect(options.executeTool).not.toHaveBeenCalled()
  })
})
