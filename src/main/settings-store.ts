import { safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import {
  applySettingsPatch,
  normalizeStoredSettings,
  type AppSettings,
  type SettingsPatch,
  type StoredAiProfile,
  type StoredSettings
} from './settings'

export interface SettingsStore {
  read: () => Promise<StoredSettings>
  update: (patch: SettingsPatch) => Promise<AppSettings>
  toPublic: (stored: StoredSettings) => AppSettings
  decodeApiKey: (profile: StoredAiProfile) => string
  /** 当前生效的论文库目录（未自定义时返回默认目录） */
  libraryDirectory: () => Promise<string>
}

export const createSettingsStore = (
  settingsFile: string,
  defaultLibraryDirectory: string
): SettingsStore => {
  const resolveLibraryDirectory = (stored: StoredSettings): string =>
    stored.library.directory || defaultLibraryDirectory

  // API Key 优先用系统钥匙串加密；系统不支持时退化为明文存储
  const encodeApiKey = (apiKey: string): { apiKey: string; apiKeyEncrypted: boolean } => {
    if (!apiKey) return { apiKey: '', apiKeyEncrypted: false }
    if (safeStorage.isEncryptionAvailable()) {
      return {
        apiKey: safeStorage.encryptString(apiKey).toString('base64'),
        apiKeyEncrypted: true
      }
    }
    return { apiKey, apiKeyEncrypted: false }
  }

  const decodeApiKey = (profile: StoredAiProfile): string => {
    if (!profile.apiKey) return ''
    if (!profile.apiKeyEncrypted) return profile.apiKey
    try {
      return safeStorage.decryptString(Buffer.from(profile.apiKey, 'base64'))
    } catch {
      // 换了机器或钥匙串不可用时解密会失败，按空 Key 处理
      return ''
    }
  }

  const read = async (): Promise<StoredSettings> => {
    try {
      const raw = await readFile(settingsFile, 'utf-8')
      return normalizeStoredSettings(JSON.parse(raw))
    } catch {
      return normalizeStoredSettings(null)
    }
  }

  const toPublic = (stored: StoredSettings): AppSettings => ({
    theme: stored.theme,
    ai: {
      activeId: stored.ai.activeId,
      profiles: stored.ai.profiles.map((profile) => ({
        id: profile.id,
        baseUrl: profile.baseUrl,
        apiKey: decodeApiKey(profile),
        model: profile.model
      }))
    },
    library: { directory: resolveLibraryDirectory(stored) }
  })

  const update = async (patch: SettingsPatch): Promise<AppSettings> => {
    const stored = applySettingsPatch(await read(), patch, encodeApiKey)
    // 自定义目录在保存时就创建，权限问题能尽早反馈；空字符串表示使用默认目录
    if (stored.library.directory) {
      await mkdir(stored.library.directory, { recursive: true })
    }
    await writeFile(settingsFile, JSON.stringify(stored, null, 2), 'utf-8')
    return toPublic(stored)
  }

  const libraryDirectory = async (): Promise<string> => resolveLibraryDirectory(await read())

  return { read, update, toPublic, decodeApiKey, libraryDirectory }
}
