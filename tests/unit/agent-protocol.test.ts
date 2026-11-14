import { describe, expect, it } from 'vitest'
import { parseHostMessage, parseStartMessage } from '../../src/main/agent/protocol'

interface StartPayload {
  sessionId: string
  mode: string
  messages: { role: string; content: string }[]
  toolNames: string[]
  maxSteps: number
}

const validStart = (): StartPayload => ({
  sessionId: 'session-1',
  mode: 'agent',
  messages: [{ role: 'user', content: 'hi' }],
  toolNames: ['library.list'],
  maxSteps: 6
})

describe('parseHostMessage', () => {
  it('rejects non-object payloads', () => {
    for (const value of [null, undefined, 'ready', 42, []]) {
      expect(() => parseHostMessage(value)).toThrow('agent 宿主消息必须是对象')
    }
  })

  it('accepts lifecycle messages', () => {
    expect(parseHostMessage({ type: 'ready' })).toEqual({ type: 'ready' })
    expect(parseHostMessage({ type: 'stopped' })).toEqual({ type: 'stopped' })
  })

  it('validates chat requests and trims identifiers', () => {
    const messages = [{ role: 'user', content: 'hi' }]

    expect(
      parseHostMessage({
        type: 'chat-request',
        requestId: ' req-1 ',
        sessionId: ' session-1 ',
        messages
      })
    ).toEqual({ type: 'chat-request', requestId: 'req-1', sessionId: 'session-1', messages })

    expect(() =>
      parseHostMessage({ type: 'chat-request', requestId: '', sessionId: 's', messages })
    ).toThrow('请求 id必须是非空字符串')
    expect(() =>
      parseHostMessage({ type: 'chat-request', requestId: 'r', sessionId: 's' })
    ).toThrow('对话消息无法序列化')
    expect(() =>
      parseHostMessage({
        type: 'chat-request',
        requestId: 'r',
        sessionId: 's',
        messages: { content: 'x'.repeat(200_001) }
      })
    ).toThrow('对话消息过大')
  })

  it('validates tool requests including serializable input', () => {
    expect(
      parseHostMessage({
        type: 'tool-request',
        requestId: 'r',
        sessionId: 's',
        name: 'library.list',
        input: { query: 'attention' }
      })
    ).toEqual({
      type: 'tool-request',
      requestId: 'r',
      sessionId: 's',
      name: 'library.list',
      input: { query: 'attention' }
    })

    // 无参数工具允许 input 缺省
    expect(
      parseHostMessage({
        type: 'tool-request',
        requestId: 'r',
        sessionId: 's',
        name: 'library.list'
      })
    ).toMatchObject({ input: undefined })

    expect(() =>
      parseHostMessage({
        type: 'tool-request',
        requestId: 'r',
        sessionId: 's',
        name: 'library.list',
        input: { value: 1n }
      })
    ).toThrow('工具参数无法序列化')
    expect(() =>
      parseHostMessage({
        type: 'tool-request',
        requestId: 'r',
        sessionId: 's',
        name: 'library.list',
        input: 'x'.repeat(100_001)
      })
    ).toThrow('工具参数过大')
    expect(() =>
      parseHostMessage({
        type: 'tool-request',
        requestId: 'r',
        sessionId: 's',
        name: 'x'.repeat(101)
      })
    ).toThrow('工具名称过长')
  })

  it('validates loop events', () => {
    expect(
      parseHostMessage({
        type: 'event',
        sessionId: 's',
        event: { type: 'tool-call', callId: 'c1', name: 'library.list' }
      })
    ).toEqual({
      type: 'event',
      sessionId: 's',
      event: { type: 'tool-call', callId: 'c1', name: 'library.list' }
    })

    expect(
      parseHostMessage({
        type: 'event',
        sessionId: 's',
        event: { type: 'tool-result', callId: 'c1', name: 'library.list', content: '{"total":1}' }
      })
    ).toMatchObject({ event: { type: 'tool-result', content: '{"total":1}' } })

    expect(
      parseHostMessage({
        type: 'event',
        sessionId: 's',
        event: { type: 'tool-error', callId: 'c1', name: 'library.list', error: '失败' }
      })
    ).toMatchObject({ event: { type: 'tool-error', error: '失败' } })

    expect(() =>
      parseHostMessage({ type: 'event', sessionId: 's', event: { type: 'chunk', delta: 'x' } })
    ).toThrow('未知的 agent 事件')
    expect(() =>
      parseHostMessage({
        type: 'event',
        sessionId: 's',
        event: { type: 'tool-call', callId: 'c1' }
      })
    ).toThrow('工具名称必须是非空字符串')
    expect(() => parseHostMessage({ type: 'event', sessionId: 's', event: 'tool-call' })).toThrow(
      'agent 事件必须是对象'
    )
  })

  it('validates done summaries', () => {
    expect(
      parseHostMessage({
        type: 'done',
        sessionId: 's',
        result: { text: '完成', steps: 2, finishReason: 'stop' }
      })
    ).toEqual({
      type: 'done',
      sessionId: 's',
      result: { text: '完成', steps: 2, finishReason: 'stop' }
    })

    const done = (result: unknown): { type: string; sessionId: string; result: unknown } => ({
      type: 'done',
      sessionId: 's',
      result
    })

    expect(() => parseHostMessage(done(null))).toThrow('运行结果必须是对象')
    expect(() => parseHostMessage(done({ text: '', steps: -1, finishReason: 'stop' }))).toThrow(
      '运行步数不正确'
    )
    expect(() => parseHostMessage(done({ text: '', steps: 1.5, finishReason: 'stop' }))).toThrow(
      '运行步数不正确'
    )
    expect(() => parseHostMessage(done({ text: '', steps: 101, finishReason: 'stop' }))).toThrow(
      '运行步数不正确'
    )
    expect(() => parseHostMessage(done({ text: '', steps: 1, finishReason: 'later' }))).toThrow(
      '结束原因不正确'
    )
    expect(() => parseHostMessage(done({ text: 1, steps: 1, finishReason: 'stop' }))).toThrow(
      '运行结果文本不正确'
    )
    expect(() =>
      parseHostMessage(done({ text: 'x'.repeat(100_001), steps: 1, finishReason: 'stop' }))
    ).toThrow('运行结果文本不正确')
  })

  it('validates error messages', () => {
    expect(parseHostMessage({ type: 'error', sessionId: 's', message: '网络错误' })).toEqual({
      type: 'error',
      sessionId: 's',
      message: '网络错误'
    })

    expect(() => parseHostMessage({ type: 'error', sessionId: 's' })).toThrow(
      '错误信息必须是非空字符串'
    )
    expect(() =>
      parseHostMessage({ type: 'error', sessionId: 's', message: 'x'.repeat(2001) })
    ).toThrow('错误信息过长')
  })

  it('rejects unknown message types', () => {
    expect(() => parseHostMessage({ type: 'chat' })).toThrow('未知的 agent 宿主消息')
  })
})

describe('parseStartMessage', () => {
  it('accepts a valid start message and trims names', () => {
    expect(parseStartMessage({ ...validStart(), toolNames: [' library.list '] })).toEqual({
      ...validStart(),
      toolNames: ['library.list']
    })
  })

  it('rejects malformed identifiers and modes', () => {
    expect(() => parseStartMessage({ ...validStart(), sessionId: '' })).toThrow(
      '会话 id必须是非空字符串'
    )
    expect(() => parseStartMessage({ ...validStart(), mode: 'auto' })).toThrow('agent 模式不正确')
  })

  it('validates messages and tool names', () => {
    expect(() => parseStartMessage({ ...validStart(), messages: 'hi' })).toThrow(
      '对话消息必须是数组'
    )
    expect(() =>
      parseStartMessage({
        ...validStart(),
        messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' }))
      })
    ).toThrow('对话消息数量超过允许值')
    expect(() => parseStartMessage({ ...validStart(), toolNames: 'library.list' })).toThrow(
      '工具列表必须是数组'
    )
    expect(() =>
      parseStartMessage({
        ...validStart(),
        toolNames: Array.from({ length: 51 }, () => 'library.list')
      })
    ).toThrow('工具数量超过允许值')
    expect(() => parseStartMessage({ ...validStart(), toolNames: ['  '] })).toThrow(
      '工具名称必须是非空字符串'
    )
  })

  it('validates the step budget', () => {
    for (const maxSteps of [0, 101, 1.5, '6', undefined]) {
      expect(() => parseStartMessage({ ...validStart(), maxSteps })).toThrow('步数上限不正确')
    }
  })

  it('rejects non-object values', () => {
    expect(() => parseStartMessage(null)).toThrow('启动消息必须是对象')
    expect(() => parseStartMessage([])).toThrow('启动消息必须是对象')
  })
})
