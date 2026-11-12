import { safeStorage } from 'electron'
import { readFile, writeFile } from 'fs/promises'
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
}

export const createSettingsStore = (settingsFile: string): SettingsStore => {
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
    }
  })

  const update = async (patch: SettingsPatch): Promise<AppSettings> => {
    const stored = applySettingsPatch(await read(), patch, encodeApiKey)
    await writeFile(settingsFile, JSON.stringify(stored, null, 2), 'utf-8')
    return toPublic(stored)
  }

  return { read, update, toPublic, decodeApiKey }
}
