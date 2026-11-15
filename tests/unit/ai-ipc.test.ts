import { EventEmitter } from 'node:events'
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { StreamChatResult } from '../../src/main/ai'
import type { AiRequester } from '../../src/main/ai-request'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    },
    on: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.listeners.set(channel, handler)
    }
  }
}))

let registerAiIpc: typeof import('../../src/main/ipc/ai').registerAiIpc

beforeAll(async () => {
  ;({ registerAiIpc } = await import('../../src/main/ipc/ai'))
})

beforeEach(() => {
  electron.handlers.clear()
  electron.listeners.clear()
})

const chatResult = (text: string): StreamChatResult => ({
  text,
  toolCalls: [],
  finishReason: 'stop'
})

interface FakeSenderObject {
  isDestroyed: () => boolean
  send: (channel: string, payload: unknown) => void
  once: (event: string, listener: () => void) => EventEmitter
  removeListener: (event: string, listener: () => void) => EventEmitter
}

interface FakeSender {
  event: { sender: FakeSenderObject }
  sent: { channel: string; payload: unknown }[]
  emitter: EventEmitter
  markDestroyed: () => void
  destroy: () => void
}

const createSender = (initiallyDestroyed = false): FakeSender => {
  const emitter = new EventEmitter()
  let destroyed = initiallyDestroyed
  const sent: { channel: string; payload: unknown }[] = []
  const sender: FakeSenderObject = {
    isDestroyed: (): boolean => destroyed,
    send: (channel: string, payload: unknown): void => {
      sent.push({ channel, payload })
    },
    once: emitter.once.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter)
  }
  return {
    event: { sender },
    sent,
    emitter,
    markDestroyed: (): void => {
      destroyed = true
    },
    destroy: (): void => {
      destroyed = true
      emitter.emit('destroyed')
    }
  }
}

interface FakeRequester {
  requester: AiRequester
  chat: Mock<AiRequester['chat']>
  abort: Mock<AiRequester['abort']>
}

const createRequester = (text = 'complete'): FakeRequester => {
  const chat = vi.fn<AiRequester['chat']>(async (request) => {
    request.onDelta('first')
    request.onDelta('second')
    return chatResult(text)
  })
  const abort = vi.fn<AiRequester['abort']>()
  return { requester: { chat, abort }, chat, abort }
}

type ChatHandler = (
  event: unknown,
  requestId: unknown,
  messages: unknown,
  profileId: unknown
) => Promise<string>

const chatHandler = (): ChatHandler => electron.handlers.get('ai:chat') as ChatHandler

describe('ai:chat', () => {
  it('returns the final text and streams deltas to the sender', async () => {
    const { requester, chat } = createRequester('translated')
    registerAiIpc(requester)
    const { event, sent } = createSender()
    const messages = [{ role: 'user', content: 'hello' }]

    const text = await chatHandler()(event, 'req-1', messages, 'profile-1')

    expect(text).toBe('translated')
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1', profileId: 'profile-1', messages })
    )
    expect(sent).toEqual([
      { channel: 'ai:chunk', payload: { requestId: 'req-1', delta: 'first' } },
      { channel: 'ai:chunk', payload: { requestId: 'req-1', delta: 'second' } }
    ])
  })

  it('does not send deltas after the sender was destroyed', async () => {
    const { requester, chat } = createRequester()
    registerAiIpc(requester)
    const sender = createSender()
    chat.mockImplementation(async (request) => {
      sender.markDestroyed()
      request.onDelta('late')
      return chatResult('ok')
    })

    await expect(chatHandler()(sender.event, 'req-1', [], 'profile-1')).resolves.toBe('ok')

    expect(sender.sent).toEqual([])
  })

  it('aborts the in-flight request when the sender is destroyed', async () => {
    const { requester, chat, abort } = createRequester()
    chat.mockImplementation(() => new Promise<StreamChatResult>(() => undefined))
    registerAiIpc(requester)
    const sender = createSender()

    void chatHandler()(sender.event, 'req-1', [], 'profile-1')
    sender.destroy()

    expect(abort).toHaveBeenCalledWith('req-1')
  })

  it('stops listening for destruction once the request settles', async () => {
    const { requester, chat, abort } = createRequester()
    registerAiIpc(requester)

    const resolved = createSender()
    await chatHandler()(resolved.event, 'req-1', [], 'profile-1')
    expect(resolved.emitter.listenerCount('destroyed')).toBe(0)
    resolved.destroy()
    expect(abort).not.toHaveBeenCalled()

    chat.mockRejectedValueOnce(new Error('network down'))
    const rejected = createSender()
    await expect(chatHandler()(rejected.event, 'req-2', [], 'profile-1')).rejects.toThrow(
      'network down'
    )
    expect(rejected.emitter.listenerCount('destroyed')).toBe(0)
  })

  it('rejects invalid request and profile ids before calling the requester', async () => {
    const { requester, chat } = createRequester()
    registerAiIpc(requester)
    const { event } = createSender()
    const handler = chatHandler()

    await expect(handler(event, 42, [], 'profile-1')).rejects.toThrow('请求标识不正确')
    await expect(handler(event, '', [], 'profile-1')).rejects.toThrow('请求标识不正确')
    await expect(handler(event, 'x'.repeat(101), [], 'profile-1')).rejects.toThrow('请求标识不正确')
    await expect(handler(event, 'req-1', [], 42)).rejects.toThrow('请先在设置中选择 AI 服务')
    await expect(handler(event, 'req-1', [], '')).rejects.toThrow('请先在设置中选择 AI 服务')
    await expect(handler(event, 'req-1', [], 'x'.repeat(101))).rejects.toThrow(
      '请先在设置中选择 AI 服务'
    )
    expect(chat).not.toHaveBeenCalled()
  })

  it('accepts request ids at the maximum length', async () => {
    const { requester, chat } = createRequester()
    registerAiIpc(requester)
    const { event } = createSender()

    await chatHandler()(event, 'x'.repeat(100), [], 'profile-1')

    expect(chat).toHaveBeenCalledOnce()
  })

  it('propagates requester failures to the renderer', async () => {
    const { requester, chat } = createRequester()
    chat.mockRejectedValueOnce(new Error('模型不可用'))
    registerAiIpc(requester)

    await expect(chatHandler()(createSender().event, 'req-1', [], 'profile-1')).rejects.toThrow(
      '模型不可用'
    )
  })
})

describe('ai:abort', () => {
  it('aborts only string request ids', () => {
    const { requester, abort } = createRequester()
    registerAiIpc(requester)
    const listener = electron.listeners.get('ai:abort') as (event: unknown, id: unknown) => void

    listener({}, 'req-1')
    listener({}, 42)
    listener({}, null)

    expect(abort).toHaveBeenCalledOnce()
    expect(abort).toHaveBeenCalledWith('req-1')
  })
})
