import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSettingsStore } from '../../src/main/settings-store'
import type { StoredAiProfile } from '../../src/main/settings'

// settings-store 直接依赖 Electron 的 safeStorage；用可切换的假实现覆盖加密和降级路径
const mocks = vi.hoisted(() => {
  const state = { available: true }
  return {
    state,
    safeStorage: {
      encryptString: (value: string): Buffer => Buffer.from(`encrypted:${value}`),
      decryptString: (value: Buffer): string => {
        const text = value.toString('utf8')
        if (!text.startsWith('encrypted:')) throw new Error('cannot decrypt')
        return text.slice('encrypted:'.length)
      },
      isEncryptionAvailable: (): boolean => state.available
    }
  }
})

vi.mock('electron', () => ({ safeStorage: mocks.safeStorage }))

const EMPTY_SETTINGS = {
  theme: 'light',
  language: 'zh',
  ai: { profiles: [], activeId: '' },
  library: { directory: '', autoAnalyze: false }
}

let dir: string
let settingsFile: string
let defaultLibraryDirectory: string

const createStore = (): ReturnType<typeof createSettingsStore> =>
  createSettingsStore(settingsFile, defaultLibraryDirectory)

beforeEach(async () => {
  mocks.state.available = true
  dir = await mkdtemp(join(tmpdir(), 'reader-bai-settings-store-'))
  settingsFile = join(dir, 'settings.json')
  defaultLibraryDirectory = join(dir, 'papers')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('createSettingsStore', () => {
  it('falls back to defaults and resolves the default library directory', async () => {
    const store = createStore()
    const stored = await store.read()

    expect(stored).toEqual(EMPTY_SETTINGS)
    expect(store.toPublic(stored)).toMatchObject({
      language: 'zh',
      keyStorage: 'encrypted',
      library: { directory: defaultLibraryDirectory }
    })
    await expect(store.libraryDirectory()).resolves.toBe(defaultLibraryDirectory)
  })

  it('returns defaults when the settings file is corrupted', async () => {
    await writeFile(settingsFile, '{ not json', 'utf8')

    await expect(createStore().read()).resolves.toEqual(EMPTY_SETTINGS)
  })

  it('encrypts new keys and keeps them out of the public settings', async () => {
    const store = createStore()
    const publicSettings = await store.update({
      ai: {
        profiles: [
          {
            id: 'p1',
            baseUrl: 'https://api.example.com/v1',
            model: 'model-a',
            apiKey: 'sk-secret',
            enabled: true
          }
        ],
        activeId: 'p1'
      }
    })

    expect(publicSettings.keyStorage).toBe('encrypted')
    expect(publicSettings.ai.profiles).toEqual([
      {
        id: 'p1',
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        model: 'model-a',
        hasApiKey: true,
        enabled: true
      }
    ])

    const stored = JSON.parse(await readFile(settingsFile, 'utf8')) as {
      ai: { profiles: StoredAiProfile[] }
    }
    const profile = stored.ai.profiles[0] as StoredAiProfile
    expect(profile.apiKeyEncrypted).toBe(true)
    expect(profile.apiKey).not.toBe('sk-secret')
    expect(store.decodeApiKey(profile)).toBe('sk-secret')
  })

  it('persists the provider per profile and returns it publicly', async () => {
    const store = createStore()

    const publicSettings = await store.update({
      ai: {
        profiles: [
          {
            id: 'p1',
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
            model: 'claude-test',
            apiKey: 'sk-ant',
            enabled: true
          }
        ],
        activeId: 'p1'
      }
    })

    expect(publicSettings.ai.profiles[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-test'
    })
    const stored = JSON.parse(await readFile(settingsFile, 'utf8')) as {
      ai: { profiles: StoredAiProfile[] }
    }
    expect(stored.ai.profiles[0].provider).toBe('anthropic')
  })

  it('treats an undecryptable key as missing', async () => {
    await writeFile(
      settingsFile,
      JSON.stringify({
        ai: {
          profiles: [
            {
              id: 'p1',
              baseUrl: 'https://api.example.com/v1',
              apiKey: 'bogus',
              apiKeyEncrypted: true,
              model: 'model-a'
            }
          ],
          activeId: 'p1'
        }
      }),
      'utf8'
    )

    const store = createStore()
    const stored = await store.read()
    const profile = stored.ai.profiles[0] as StoredAiProfile

    expect(profile.apiKey).toBe('bogus')
    // 换了机器或钥匙串不可用时解密会失败，按空 Key 处理而不是抛错
    expect(store.decodeApiKey(profile)).toBe('')
  })

  it('stores keys as plaintext when the system key store is unavailable', async () => {
    mocks.state.available = false

    const store = createStore()
    const publicSettings = await store.update({
      ai: {
        profiles: [
          {
            id: 'p1',
            baseUrl: 'https://api.example.com/v1',
            model: 'model-a',
            apiKey: 'sk-plain',
            enabled: true
          }
        ],
        activeId: 'p1'
      }
    })

    expect(publicSettings.keyStorage).toBe('plaintext')
    const stored = JSON.parse(await readFile(settingsFile, 'utf8')) as {
      ai: { profiles: StoredAiProfile[] }
    }
    const profile = stored.ai.profiles[0] as StoredAiProfile
    expect(profile).toMatchObject({ apiKey: 'sk-plain', apiKeyEncrypted: false })
    expect(store.decodeApiKey(profile)).toBe('sk-plain')
  })

  it('creates and remembers a custom library directory', async () => {
    const store = createStore()
    const custom = join(dir, 'custom-papers')

    const publicSettings = await store.update({ library: { directory: custom } })

    expect(publicSettings.library.directory).toBe(custom)
    await expect(stat(custom)).resolves.toBeDefined()
    await expect(store.libraryDirectory()).resolves.toBe(custom)

    // 空字符串表示恢复默认目录
    await store.update({ library: { directory: '' } })
    await expect(store.libraryDirectory()).resolves.toBe(defaultLibraryDirectory)
  })

  it('rejects updates when the settings file cannot be written', async () => {
    const store = createSettingsStore(
      join(dir, 'missing', 'settings.json'),
      defaultLibraryDirectory
    )

    await expect(store.update({ theme: 'dark' })).rejects.toThrow()
  })
})
