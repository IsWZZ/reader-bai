import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { StreamChatResult } from '../../../../main/ai'
import type { AiRequester } from '../../../../main/ai-request'
import { createTranslationRuntime } from '../../main/runtime'

const electron = vi.hoisted(() => ({ fork: vi.fn() }))

vi.mock('electron', () => ({ utilityProcess: { fork: electron.fork } }))

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

class FakeSender extends EventEmitter {
  sent: Array<{ channel: string; payload: unknown }> = []
  destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
}

const chat = vi.fn<AiRequester['chat']>()
const abort = vi.fn<AiRequester['abort']>()
const requester: AiRequester = { chat, abort }

const createRuntime = (): ReturnType<typeof createTranslationRuntime> =>
  createTranslationRuntime({
    hostScript: '/tmp/translation-host.js',
    requester
  })

const flush = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

const startHost = async (
  runtime: ReturnType<typeof createTranslationRuntime>,
  proc: FakeProcess
): Promise<void> => {
  const activation = runtime.activate()
  proc.emit('message', { type: 'ready' })
  await activation
}

beforeEach(() => {
  electron.fork.mockReset()
  chat.mockReset()
  abort.mockReset()
})

describe('translation runtime', () => {
  it('forks the host lazily and reuses it after activation', async () => {
    const proc = new FakeProcess()
    electron.fork.mockReturnValue(proc)
    const runtime = createRuntime()

    const activation = runtime.activate()
    expect(electron.fork).toHaveBeenCalledWith('/tmp/translation-host.js', [], {
      serviceName: 'reader-bai translation'
    })

    proc.emit('message', { type: 'ready' })
    await activation
    await runtime.activate()

    expect(electron.fork).toHaveBeenCalledTimes(1)
  })

  it('forwards chunks and resolves with the final text', async () => {
    const proc = new FakeProcess()
    electron.fork.mockReturnValue(proc)
    const runtime = createRuntime()
    await startHost(runtime, proc)

    const sender = new FakeSender()
    chat.mockImplementation(async ({ onDelta }) => {
      onDelta('你')
      return { text: '你好', finishReason: 'stop' }
    })

    const pending = runtime.translate(sender as unknown as WebContents, {
      requestId: 'r1',
      source: 'Hello',
      profileId: 'p1'
    })
    await flush()

    expect(proc.messages).toContainEqual({ type: 'translate', requestId: 'r1', source: 'Hello' })

    proc.emit('message', {
      type: 'chat-request',
      requestId: 'r1',
      messages: [{ role: 'user', content: 'Hello' }]
    })
    await flush()

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'r1',
        profileId: 'p1',
        messages: [{ role: 'user', content: 'Hello' }]
      })
    )
    expect(sender.sent).toContainEqual({
      channel: 'translation:chunk',
      payload: { requestId: 'r1', delta: '你' }
    })

    proc.emit('message', { type: 'done', requestId: 'r1', text: '你好' })
    await expect(pending).resolves.toBe('你好')
  })

  it('waits for ready before sending a translation request', async () => {
    const proc = new FakeProcess()
    electron.fork.mockReturnValue(proc)
    const runtime = createRuntime()
    const sender = new FakeSender()

    const pending = runtime.translate(sender as unknown as WebContents, {
      requestId: 'r1',
      source: 'Hello',
      profileId: 'p1'
    })
    await flush()
    expect(proc.messages).not.toContainEqual(expect.objectContaining({ type: 'translate' }))

    proc.emit('message', { type: 'ready' })
    await flush()
    expect(proc.messages).toContainEqual({ type: 'translate', requestId: 'r1', source: 'Hello' })

    proc.emit('message', { type: 'error', requestId: 'r1', message: '停止' })
    await expect(pending).rejects.toThrow('停止')
  })

  it('aborts an in-flight request and resolves with the partial text', async () => {
    const proc = new FakeProcess()
    electron.fork.mockReturnValue(proc)
    const runtime = createRuntime()
    await startHost(runtime, proc)

    const sender = new FakeSender()
    chat.mockImplementation(
      ({ signal, onDelta }) =>
        new Promise<StreamChatResult>((resolve) => {
          onDelta('部分')
          signal?.addEventListener('abort', () => {
            resolve({ text: '部分', finishReason: 'aborted' })
          })
        })
    )

    const pending = runtime.translate(sender as unknown as WebContents, {
      requestId: 'r1',
      source: 'Hello',
      profileId: 'p1'
    })
    await flush()
    proc.emit('message', { type: 'chat-request', requestId: 'r1', messages: [] })
    await flush()

    runtime.abort('r1')

    await expect(pending).resolves.toBe('部分')
    expect(abort).toHaveBeenCalledWith('r1')
    expect(proc.messages).toContainEqual({ type: 'cancel', requestId: 'r1' })
  })

  it('fails active sessions when the host exits', async () => {
    const proc = new FakeProcess()
    electron.fork.mockReturnValue(proc)
    const runtime = createRuntime()
    await startHost(runtime, proc)

    const sender = new FakeSender()
    chat.mockImplementation(() => new Promise<StreamChatResult>(() => undefined))

    const pending = runtime.translate(sender as unknown as WebContents, {
      requestId: 'r1',
      source: 'Hello',
      profileId: 'p1'
    })
    await flush()
    proc.emit('message', { type: 'chat-request', requestId: 'r1', messages: [] })
    await flush()

    proc.emit('exit', 1)

    await expect(pending).rejects.toThrow('翻译进程已退出（1）')
    expect(abort).toHaveBeenCalledWith('r1')
  })

  it('stops the host, settles sessions and is idempotent', async () => {
    const proc = new FakeProcess()
    electron.fork.mockReturnValue(proc)
    const runtime = createRuntime()
    await startHost(runtime, proc)

    const sender = new FakeSender()
    chat.mockImplementation(() => new Promise<StreamChatResult>(() => undefined))
    const pending = runtime.translate(sender as unknown as WebContents, {
      requestId: 'r1',
      source: 'Hello',
      profileId: 'p1'
    })
    await flush()

    const stopping = runtime.stop()
    await expect(pending).resolves.toBe('')
    expect(proc.messages).toContainEqual({ type: 'stop' })

    proc.emit('exit', 0)
    await stopping
    await runtime.stop()

    expect(proc.killed).toBe(false)
  })

  it('rejects invalid requests before starting the host', async () => {
    const runtime = createRuntime()
    const sender = new FakeSender()

    await expect(
      runtime.translate(sender as unknown as WebContents, {
        requestId: '',
        source: 'Hello',
        profileId: 'p1'
      })
    ).rejects.toThrow('请求标识必须是非空字符串')
    expect(electron.fork).not.toHaveBeenCalled()
  })

  it('rejects translations from a destroyed window', async () => {
    const runtime = createRuntime()
    const sender = new FakeSender()
    sender.destroyed = true

    await expect(
      runtime.translate(sender as unknown as WebContents, {
        requestId: 'r1',
        source: 'Hello',
        profileId: 'p1'
      })
    ).rejects.toThrow('窗口已关闭')
  })
})
