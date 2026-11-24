import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiRequester } from '../../../../main/ai-request'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  fork: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    },
    on: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.listeners.set(channel, handler)
    }
  },
  utilityProcess: { fork: electron.fork }
}))

import { createTranslationModule } from '../../main'

const requester: AiRequester = {
  chat: vi.fn(),
  abort: vi.fn()
}

beforeEach(() => {
  electron.handlers.clear()
  electron.listeners.clear()
  electron.fork.mockReset()
})

describe('translation module', () => {
  it('registers the translation IPC without starting the host', () => {
    const module = createTranslationModule({
      hostScript: '/tmp/translation-host.js',
      requester
    })

    module.registerIpc()

    expect([...electron.handlers.keys()].sort()).toEqual([
      'translation:activate',
      'translation:translate'
    ])
    expect([...electron.listeners.keys()]).toEqual(['translation:abort'])
    expect(electron.fork).not.toHaveBeenCalled()
  })

  it('can be deactivated before the host was ever started', async () => {
    const module = createTranslationModule({
      hostScript: '/tmp/translation-host.js',
      requester
    })

    await expect(module.deactivate()).resolves.toBeUndefined()
    expect(electron.fork).not.toHaveBeenCalled()
  })
})
