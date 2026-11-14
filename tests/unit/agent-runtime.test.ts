import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { WebContents } from 'electron'
import type { AgentRun, RunLimits } from '../../src/main/ai-run'
import type { AiRequester } from '../../src/main/ai-request'
import type { ToolInfo, ToolRegistry } from '../../src/main/tool-registry'
import {
  AGENT_POLICIES,
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeOptions
} from '../../src/main/agent/runtime'

const electron = vi.hoisted(() => ({ fork: vi.fn() }))
const aiRun = vi.hoisted(() => ({ startRun: vi.fn() }))

vi.mock('electron', () => ({ utilityProcess: { fork: electron.fork } }))
vi.mock('../../src/main/ai-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/ai-run')>()
  return { ...actual, startRun: aiRun.startRun }
})

class FakeSender extends EventEmitter {
  sent: Array<{ sessionId: string; event: Record<string, unknown> }> = []
  destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(channel: string, payload: { sessionId: string; event: Record<string, unknown> }): void {
    if (channel === 'agent:event') this.sent.push(payload)
  }
}

class FakeProcess extends EventEmitter {
  messages: unknown[] = []
  killed = false

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  kill(): void {
    this.killed = true
    this.emit('exit', 0)
  }
}

const TOOL_INFOS: ToolInfo[] = [
  {
    name: 'library.list',
    title: '列出论文',
    description: '列出论文库中的论文',
    inputSchema: { type: 'object', properties: {} },
    risk: 'read',
    exposeToAi: true,
    requiredPermissions: []
  },
  {
    name: 'paper.get',
    title: '读取论文',
    description: '读取论文元数据',
    inputSchema: { type: 'object', properties: {} },
    risk: 'read',
    exposeToAi: false,
    requiredPermissions: []
  },
  {
    name: 'annotations.remove',
    title: '删除标注',
    description: '删除标注',
    inputSchema: { type: 'object', properties: {} },
    risk: 'destructive',
    exposeToAi: true,
    requiredPermissions: []
  }
]

interface RunStarterContext {
  started: AgentRun[]
  start: Mock<(limits: RunLimits) => AgentRun>
}

const makeRunStarter = (): RunStarterContext => {
  const started: AgentRun[] = []
  let sequence = 0

  const start = vi.fn((limits: RunLimits): AgentRun => {
    // 测试只关心传入的预算，不在这里实现超时逻辑
    void limits
    const controller = new AbortController()
    let abortReason: AgentRun['abortReason'] = null
    const run: AgentRun = {
      id: `run-${(sequence += 1)}`,
      signal: controller.signal,
      usage: { steps: 0, inputTokens: 0, outputTokens: 0 },
      get abortReason() {
        return abortReason
      },
      get isAborted() {
        return controller.signal.aborted
      },
      recordStep: vi.fn(),
      cancel: vi.fn((reason: NonNullable<AgentRun['abortReason']> = 'user') => {
        if (controller.signal.aborted) return
        abortReason = reason
        controller.abort()
      }),
      dispose: vi.fn()
    }
    started.push(run)
    return run
  })

  return { started, start }
}

interface Context {
  runtime: AgentRuntime
  sender: FakeSender
  proc: FakeProcess
  tools: { list: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> } & ToolRegistry
  requester: { chat: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> } & AiRequester
  runStarter: RunStarterContext
  options: AgentRuntimeOptions
}

const createContext = (onLog?: (message: string) => void): Context => {
  const proc = new FakeProcess()
  electron.fork.mockReturnValue(proc)

  const tools = {
    register: vi.fn(),
    list: vi.fn(({ forAi = false }: { forAi?: boolean } = {}) =>
      TOOL_INFOS.filter((tool) => !forAi || tool.exposeToAi)
    ),
    get: vi.fn(),
    execute: vi.fn(async () => ({ content: '{"total":1}' }))
  } as unknown as Context['tools']

  const requester = {
    chat: vi.fn(async () => ({ text: '回复', toolCalls: [], finishReason: 'stop' as const })),
    abort: vi.fn()
  } as unknown as Context['requester']

  const runStarter = makeRunStarter()
  aiRun.startRun.mockImplementation(runStarter.start)
  const options: AgentRuntimeOptions = {
    hostScript: '/tmp/agent-host.js',
    requester,
    tools,
    onLog
  }

  return {
    runtime: createAgentRuntime(options),
    sender: new FakeSender(),
    proc,
    tools,
    requester,
    runStarter,
    options
  }
}

const VALID_REQUEST = {
  messages: [{ role: 'user', content: 'hi' }],
  profileId: 'profile-1',
  mode: 'agent' as const
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

const startSession = async (
  context: Context,
  request: unknown = VALID_REQUEST
): Promise<string> => {
  const pending = context.runtime.start(context.sender as unknown as WebContents, request)
  context.proc.emit('spawn')
  return (await pending).id
}

const hostMessage = (context: Context, message: unknown): void => {
  context.proc.emit('message', message)
}

const lastEvent = (context: Context): { sessionId: string; event: Record<string, unknown> } =>
  context.sender.sent[context.sender.sent.length - 1]

const responses = (context: Context): Record<string, unknown>[] =>
  context.proc.messages.filter(
    (message): message is Record<string, unknown> =>
      Boolean(message) &&
      typeof message === 'object' &&
      (message as { type?: unknown }).type === 'response'
  )

describe('agent runtime', () => {
  beforeEach(() => {
    electron.fork.mockReset()
  })

  it('starts the host and applies the agent policy and tool allowlist', async () => {
    const context = createContext()

    const id = await startSession(context)

    expect(id).toBe('run-1')
    expect(electron.fork).toHaveBeenCalledWith('/tmp/agent-host.js', [], {
      serviceName: 'reader-bai agent'
    })
    expect(context.runStarter.start).toHaveBeenCalledWith(AGENT_POLICIES.agent)
    expect(context.tools.list).toHaveBeenCalledWith({ forAi: true })
    expect(context.proc.messages[0]).toEqual({
      type: 'start',
      sessionId: 'run-1',
      mode: 'agent',
      messages: VALID_REQUEST.messages,
      toolNames: ['library.list'],
      maxSteps: 6
    })
  })

  it('opens no tools and a single step in chat mode', async () => {
    const context = createContext()

    await startSession(context, { ...VALID_REQUEST, mode: 'chat' })

    expect(context.runStarter.start).toHaveBeenCalledWith(AGENT_POLICIES.chat)
    expect(context.proc.messages[0]).toMatchObject({
      mode: 'chat',
      toolNames: [],
      maxSteps: 1
    })
  })

  it('rejects invalid requests before spawning a host', async () => {
    const context = createContext()
    const start = (request: unknown): Promise<unknown> =>
      context.runtime.start(context.sender as unknown as WebContents, request)

    await expect(start('fast')).rejects.toThrow('启动参数必须是对象')
    await expect(start({ ...VALID_REQUEST, profileId: '' })).rejects.toThrow(
      '请先在设置中选择 AI 服务'
    )
    await expect(start({ ...VALID_REQUEST, mode: 'auto' })).rejects.toThrow('对话模式不正确')
    await expect(start({ ...VALID_REQUEST, messages: [] })).rejects.toThrow('消息不能为空')

    expect(electron.fork).not.toHaveBeenCalled()
    expect(context.runStarter.start).not.toHaveBeenCalled()
  })

  it('forwards host events and the final summary to the sender', async () => {
    const context = createContext()
    const id = await startSession(context)

    hostMessage(context, {
      type: 'event',
      sessionId: id,
      event: { type: 'tool-call', callId: 'call-1', name: 'library.list' }
    })
    expect(lastEvent(context)).toEqual({
      sessionId: id,
      event: { type: 'tool-call', callId: 'call-1', name: 'library.list' }
    })

    hostMessage(context, {
      type: 'done',
      sessionId: id,
      result: { text: '完成', steps: 2, finishReason: 'stop' }
    })
    expect(lastEvent(context)).toEqual({
      sessionId: id,
      event: { type: 'done', text: '完成', steps: 2, finishReason: 'stop' }
    })
    expect(context.runStarter.started[0].dispose).toHaveBeenCalled()

    // 结束后再取消是幂等的
    context.runtime.cancel(id)
    expect(responses(context)).toEqual([])
    expect(context.proc.messages).not.toContainEqual({ type: 'cancel', sessionId: id })
  })

  it('ignores events for unknown sessions and malformed host messages', async () => {
    const onLog = vi.fn()
    const context = createContext(onLog)
    await startSession(context)

    hostMessage(context, {
      type: 'event',
      sessionId: 'missing',
      event: { type: 'tool-call', callId: 'call-1', name: 'library.list' }
    })
    hostMessage(context, { type: 'chat' })

    expect(context.sender.sent).toEqual([])
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('忽略非法的 agent 宿主消息'))
  })

  it('routes chat requests through the requester and streams deltas', async () => {
    const context = createContext()
    const id = await startSession(context)
    context.requester.chat.mockImplementation(
      async (request: { onDelta: (delta: string) => void }) => {
        request.onDelta('你')
        return { text: '你好', toolCalls: [], finishReason: 'stop' }
      }
    )

    hostMessage(context, {
      type: 'chat-request',
      requestId: 'req-1',
      sessionId: id,
      messages: [{ role: 'user', content: 'hi' }]
    })
    await flush()

    expect(context.requester.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        messages: [{ role: 'user', content: 'hi' }],
        profileId: 'profile-1',
        toolNames: ['library.list'],
        run: context.runStarter.started[0],
        signal: expect.any(AbortSignal)
      })
    )
    expect(context.sender.sent).toContainEqual({
      sessionId: id,
      event: { type: 'chunk', delta: '你' }
    })
    expect(responses(context)).toEqual([
      {
        type: 'response',
        requestId: 'req-1',
        ok: true,
        result: { text: '你好', toolCalls: [], finishReason: 'stop' }
      }
    ])
  })

  it('reports chat failures and requests for unknown sessions', async () => {
    const context = createContext()
    const id = await startSession(context)
    context.requester.chat.mockRejectedValueOnce(new Error('服务不可用'))

    hostMessage(context, {
      type: 'chat-request',
      requestId: 'req-1',
      sessionId: id,
      messages: [{ role: 'user', content: 'hi' }]
    })
    await flush()
    expect(responses(context)[0]).toMatchObject({ ok: false, error: '服务不可用' })

    hostMessage(context, {
      type: 'chat-request',
      requestId: 'req-2',
      sessionId: 'missing',
      messages: [{ role: 'user', content: 'hi' }]
    })
    await flush()
    expect(responses(context)[1]).toMatchObject({ ok: false, error: '运行不存在或已结束' })
  })

  it('executes only tools opened to the session', async () => {
    const context = createContext()
    const id = await startSession(context)

    hostMessage(context, {
      type: 'tool-request',
      requestId: 'req-1',
      sessionId: id,
      name: 'library.list',
      input: { query: 'attention' }
    })
    await flush()

    expect(context.tools.execute).toHaveBeenCalledWith(
      'library.list',
      { query: 'attention' },
      {
        source: 'ai',
        signal: expect.any(AbortSignal),
        runId: id
      }
    )
    expect(responses(context)[0]).toMatchObject({ ok: true, result: { content: '{"total":1}' } })

    hostMessage(context, {
      type: 'tool-request',
      requestId: 'req-2',
      sessionId: id,
      name: 'annotations.remove',
      input: {}
    })
    await flush()

    expect(context.tools.execute).toHaveBeenCalledTimes(1)
    expect(responses(context)[1]).toMatchObject({
      ok: false,
      error: '工具未对本次运行开放：annotations.remove'
    })
  })

  it('cancels a session and reports an aborted finish', async () => {
    const context = createContext()
    const id = await startSession(context)

    context.runtime.cancel(id)

    expect(context.runStarter.started[0].cancel).toHaveBeenCalledWith('user')
    expect(lastEvent(context)).toEqual({
      sessionId: id,
      event: { type: 'done', text: '', steps: 0, finishReason: 'aborted' }
    })
    expect(context.proc.messages).toContainEqual({ type: 'cancel', sessionId: id })
    expect(context.runStarter.started[0].dispose).toHaveBeenCalled()

    // 未知或非法 id 是幂等的
    expect(() => context.runtime.cancel('missing')).not.toThrow()
    expect(() => context.runtime.cancel(42)).not.toThrow()
  })

  it('fails active sessions when the host exits', async () => {
    const context = createContext()
    const id = await startSession(context)

    context.proc.emit('exit', 1)

    expect(context.runStarter.started[0].cancel).toHaveBeenCalledWith('error')
    expect(lastEvent(context)).toEqual({
      sessionId: id,
      event: { type: 'error', message: 'agent 宿主已退出（1）' }
    })
  })

  it('stops the host and waits for it to exit', async () => {
    const context = createContext()
    await startSession(context)

    const stopping = context.runtime.stop()
    context.proc.emit('exit', 0)
    await stopping

    expect(context.runStarter.started[0].cancel).toHaveBeenCalledWith('user')
    expect(context.proc.messages).toContainEqual({ type: 'stop' })
    expect(context.proc.killed).toBe(false)
  })
})
