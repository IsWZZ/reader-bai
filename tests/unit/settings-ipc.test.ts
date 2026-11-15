import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AppSettings, StoredSettings } from '../../src/main/settings'
import type { SettingsStore } from '../../src/main/settings-store'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showMessageBox: vi.fn(),
  fromWebContents: vi.fn(),
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: electron.fromWebContents,
    getFocusedWindow: electron.getFocusedWindow,
    getAllWindows: electron.getAllWindows
  },
  dialog: { showMessageBox: electron.showMessageBox },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    }
  }
}))

let registerSettingsIpc: typeof import('../../src/main/ipc/settings').registerSettingsIpc

beforeAll(async () => {
  ;({ registerSettingsIpc } = await import('../../src/main/ipc/settings'))
})

const OLD_BASE_URL = 'https://old.example.com/v1'

const STORED: StoredSettings = {
  theme: 'light',
  language: 'en',
  ai: {
    profiles: [
      {
        id: 'profile-1',
        provider: 'openai',
        baseUrl: OLD_BASE_URL,
        apiKey: 'secret',
        apiKeyEncrypted: false,
        model: 'gpt-test',
        enabled: true
      }
    ],
    activeId: 'profile-1'
  },
  library: { directory: '/papers', autoAnalyze: true }
}

const PUBLIC: AppSettings = {
  theme: 'light',
  language: 'en',
  ai: {
    profiles: [
      {
        id: 'profile-1',
        provider: 'openai',
        baseUrl: OLD_BASE_URL,
        model: 'gpt-test',
        hasApiKey: true,
        enabled: true
      }
    ],
    activeId: 'profile-1'
  },
  library: { directory: '/papers', autoAnalyze: true },
  keyStorage: 'encrypted'
}

interface FakeSettings {
  store: SettingsStore
  read: Mock<SettingsStore['read']>
  update: Mock<SettingsStore['update']>
  toPublic: Mock<SettingsStore['toPublic']>
}

const createSettings = (state: StoredSettings = STORED): FakeSettings => {
  const read = vi.fn<SettingsStore['read']>(async () => structuredClone(state))
  const update = vi.fn<SettingsStore['update']>(async () => structuredClone(PUBLIC))
  const toPublic = vi.fn<SettingsStore['toPublic']>(() => structuredClone(PUBLIC))
  const store = {
    read,
    update,
    toPublic,
    decodeApiKey: vi.fn(),
    libraryDirectory: vi.fn()
  } as unknown as SettingsStore
  return { store, read, update, toPublic }
}

interface ProfilePatch {
  ai: { profiles: { id: string; baseUrl: string; model: string; enabled: boolean }[] }
}

const profilePatch = (baseUrl: string, id = 'profile-1'): ProfilePatch => ({
  ai: { profiles: [{ id, baseUrl, model: 'gpt-test', enabled: true }] }
})

type GetHandler = () => Promise<AppSettings>
type UpdateHandler = (event: unknown, patch: unknown) => Promise<AppSettings>

const getHandler = (): GetHandler => electron.handlers.get('settings:get') as GetHandler
const updateHandler = (): UpdateHandler => electron.handlers.get('settings:update') as UpdateHandler

const lastDialogOptions = (): Record<string, unknown> => {
  const call = electron.showMessageBox.mock.calls.at(-1) ?? []
  return (call.length > 1 ? call[1] : call[0]) as Record<string, unknown>
}

beforeEach(() => {
  electron.handlers.clear()
  electron.showMessageBox.mockReset()
  electron.fromWebContents.mockReset()
  electron.getFocusedWindow.mockReset()
  electron.getAllWindows.mockReset()
  electron.getAllWindows.mockReturnValue([])
})

describe('settings:get', () => {
  it('returns the public view built from the stored settings', async () => {
    const settings = createSettings()
    registerSettingsIpc(settings.store)

    await expect(getHandler()()).resolves.toEqual(PUBLIC)
    expect(settings.read).toHaveBeenCalledOnce()
    expect(settings.toPublic).toHaveBeenCalledWith(STORED)
  })
})

describe('settings:update', () => {
  it('saves a patch that does not move an existing API key', async () => {
    const settings = createSettings()
    registerSettingsIpc(settings.store)
    const patch = { theme: 'dark', library: { autoAnalyze: false } }

    await expect(updateHandler()({ sender: {} }, patch)).resolves.toEqual(PUBLIC)

    expect(settings.update).toHaveBeenCalledWith(patch)
    expect(electron.showMessageBox).not.toHaveBeenCalled()
  })

  it('does not confirm path-only changes on the same origin', async () => {
    const settings = createSettings()
    registerSettingsIpc(settings.store)

    await updateHandler()({ sender: {} }, profilePatch('https://old.example.com/v2'))

    expect(electron.showMessageBox).not.toHaveBeenCalled()
    expect(settings.update).toHaveBeenCalledOnce()
  })

  it('does not confirm when the profile has no saved API key yet', async () => {
    const withoutKey: StoredSettings = {
      ...STORED,
      ai: {
        profiles: [{ ...STORED.ai.profiles[0], apiKey: '' }],
        activeId: 'profile-1'
      }
    }
    const settings = createSettings(withoutKey)
    registerSettingsIpc(settings.store)

    await updateHandler()({ sender: {} }, profilePatch('https://new.example.com/v1'))

    expect(electron.showMessageBox).not.toHaveBeenCalled()
    expect(settings.update).toHaveBeenCalledOnce()
  })

  it('does not confirm for newly added profiles', async () => {
    const settings = createSettings()
    registerSettingsIpc(settings.store)

    await updateHandler()({ sender: {} }, profilePatch('https://new.example.com/v1', 'profile-2'))

    expect(electron.showMessageBox).not.toHaveBeenCalled()
    expect(settings.update).toHaveBeenCalledOnce()
  })

  it('asks for confirmation when an existing key moves to another origin', async () => {
    const settings = createSettings()
    registerSettingsIpc(settings.store)
    const window = { id: 1 }
    electron.fromWebContents.mockReturnValue(window)
    electron.showMessageBox.mockResolvedValue({ response: 1 })

    await updateHandler()({ sender: {} }, profilePatch('https://new.example.com/v1'))

    const [target, options] = electron.showMessageBox.mock.calls[0] as [
      unknown,
      Record<string, unknown>
    ]
    expect(target).toBe(window)
    expect(options.title).toBe('确认更改 AI 服务地址')
    expect(options.buttons).toEqual(['取消', '继续保存'])
    expect(options.defaultId).toBe(0)
    expect(options.cancelId).toBe(0)
    expect(options.detail).toContain(`${OLD_BASE_URL} → https://new.example.com/v1`)
    expect(settings.update).toHaveBeenCalledOnce()
  })

  it('refuses to save when the user cancels the confirmation', async () => {
    const settings = createSettings()
    registerSettingsIpc(settings.store)
    electron.getAllWindows.mockReturnValue([{ id: 1 }])
    electron.showMessageBox.mockResolvedValue({ response: 0 })

    await expect(
      updateHandler()({ sender: {} }, profilePatch('https://new.example.com/v1'))
    ).rejects.toThrow('已取消保存：AI 服务地址未更改')

    expect(lastDialogOptions().message).toBe('已有 API Key 的配置将改为向新地址发送请求')
    expect(settings.update).not.toHaveBeenCalled()
  })

  it('shows the confirmation without a parent window when none is available', async () => {
    const settings = createSettings()
    registerSettingsIpc(settings.store)
    electron.getFocusedWindow.mockReturnValue(undefined)
    electron.showMessageBox.mockResolvedValue({ response: 0 })

    await expect(
      updateHandler()({ sender: {} }, profilePatch('https://new.example.com/v1'))
    ).rejects.toThrow('已取消保存：AI 服务地址未更改')

    expect(electron.showMessageBox.mock.calls[0]).toHaveLength(1)
    expect(electron.showMessageBox.mock.calls[0][0]).toMatchObject({
      type: 'warning',
      title: '确认更改 AI 服务地址'
    })
  })
})
