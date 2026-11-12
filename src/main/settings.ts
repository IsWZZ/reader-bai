// 设置文件的纯逻辑：清洗、旧格式迁移与 patch 合并。
// 刻意不依赖 electron，方便在 Vitest 中直接测试。

import { isAbsolute } from 'node:path'

export type AppTheme = 'light' | 'dark'

export interface AiProfile {
  id: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface AiSettings {
  profiles: AiProfile[]
  activeId: string
}

export interface LibrarySettings {
  /** 论文库目录；空字符串表示使用主进程提供的默认目录 */
  directory: string
}

export interface AppSettings {
  theme: AppTheme
  ai: AiSettings
  library: LibrarySettings
}

export interface SettingsPatch {
  theme?: AppTheme
  ai?: {
    profiles?: AiProfile[]
    activeId?: string
  }
  library?: {
    /** 空字符串表示恢复默认目录 */
    directory?: string
  }
}

// 磁盘上的形式：每条配置的 API Key 优先用系统钥匙串加密
export interface StoredAiProfile {
  id: string
  baseUrl: string
  apiKey: string
  apiKeyEncrypted: boolean
  model: string
}

export interface StoredAiSettings {
  profiles: StoredAiProfile[]
  activeId: string
}

export interface StoredSettings {
  theme: AppTheme
  ai: StoredAiSettings
  library: LibrarySettings
}

export interface EncodedKey {
  apiKey: string
  apiKeyEncrypted: boolean
}

export type EncodeApiKey = (apiKey: string) => EncodedKey

const MAX_PROFILES = 20
const MAX_ID = 100
const MAX_BASE_URL = 500
const MAX_API_KEY = 500
const MAX_DIRECTORY = 2000
// safeStorage 的密文是 base64，长度会明显超过明文
const MAX_STORED_KEY = 4096
const MAX_MODEL = 120

// 旧版本的 'system' 等已移除，读取时按浅色处理
const normalizeTheme = (value: unknown): AppTheme =>
  value === 'light' || value === 'dark' ? value : 'light'

const asString = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/** 只接受绝对路径；空路径表示使用默认目录 */
const normalizeDirectory = (value: unknown): string => {
  const directory = asString(value, MAX_DIRECTORY)
  return directory && isAbsolute(directory) ? directory : ''
}

/**
 * id 必须跨启动保持稳定，否则 activeId 会失效。
 * 缺失或重复时按数组下标生成确定性的 id，而不是随机值。
 */
const normalizeId = (value: unknown, index: number, used: Set<string>): string => {
  const raw = asString(value, MAX_ID)
  if (raw && !used.has(raw)) {
    used.add(raw)
    return raw
  }

  const base = `profile-${index + 1}`
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

const normalizeActiveId = (value: unknown, profiles: StoredAiProfile[]): string => {
  const id = asString(value, MAX_ID)
  return profiles.some((profile) => profile.id === id) ? id : (profiles[0]?.id ?? '')
}

const objectOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null

const normalizeStoredProfile = (
  raw: Record<string, unknown>,
  index: number,
  used: Set<string>
): StoredAiProfile => {
  const encrypted = raw.apiKeyEncrypted === true
  const apiKey = asString(raw.apiKey, encrypted ? MAX_STORED_KEY : MAX_API_KEY)
  return {
    id: normalizeId(raw.id, index, used),
    baseUrl: asString(raw.baseUrl, MAX_BASE_URL),
    apiKey,
    apiKeyEncrypted: encrypted && apiKey !== '',
    model: asString(raw.model, MAX_MODEL)
  }
}

/** 旧版 settings.json 只有一份 ai 配置，迁移成 id 为 default 的 profile */
const normalizeLegacyProfile = (raw: Record<string, unknown>): StoredAiProfile | null => {
  const encrypted = raw.apiKeyEncrypted === true
  const apiKey = asString(raw.apiKey, encrypted ? MAX_STORED_KEY : MAX_API_KEY)
  const profile: StoredAiProfile = {
    id: 'default',
    baseUrl: asString(raw.baseUrl, MAX_BASE_URL),
    apiKey,
    apiKeyEncrypted: encrypted && apiKey !== '',
    model: asString(raw.model, MAX_MODEL)
  }
  if (!profile.baseUrl && !profile.apiKey && !profile.model) return null
  return profile
}

export const normalizeStoredSettings = (raw: unknown): StoredSettings => {
  const source = objectOf(raw) ?? {}
  const ai = objectOf(source.ai) ?? {}

  let profiles: StoredAiProfile[]
  if (Array.isArray(ai.profiles)) {
    const used = new Set<string>()
    profiles = ai.profiles
      .slice(0, MAX_PROFILES)
      .map(objectOf)
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item, index) => normalizeStoredProfile(item, index, used))
  } else {
    // 只有没有 profiles 数组时才算旧格式；显式空数组不能回退到旧字段
    const legacy = normalizeLegacyProfile(ai)
    profiles = legacy ? [legacy] : []
  }

  const library = objectOf(source.library) ?? {}

  return {
    theme: normalizeTheme(source.theme),
    ai: { profiles, activeId: normalizeActiveId(ai.activeId, profiles) },
    library: { directory: normalizeDirectory(library.directory) }
  }
}

const encodeStoredProfile = (
  raw: Record<string, unknown>,
  index: number,
  used: Set<string>,
  encodeKey: EncodeApiKey
): StoredAiProfile => {
  const encoded = encodeKey(asString(raw.apiKey, MAX_API_KEY))
  return {
    id: normalizeId(raw.id, index, used),
    baseUrl: asString(raw.baseUrl, MAX_BASE_URL),
    apiKey: encoded.apiKey,
    apiKeyEncrypted: encoded.apiKeyEncrypted && encoded.apiKey !== '',
    model: asString(raw.model, MAX_MODEL)
  }
}

/**
 * 合并渲染进程发来的部分补丁：
 * - profiles 只有在传数组时才整体替换（并重新加密 Key）；
 * - activeId 单独传入时不动已加密的 profiles；
 * - 最后统一把 activeId 归一到存在的配置。
 */
export const applySettingsPatch = (
  stored: StoredSettings,
  patch: unknown,
  encodeKey: EncodeApiKey
): StoredSettings => {
  const next: StoredSettings = {
    theme: stored.theme,
    ai: {
      profiles: stored.ai.profiles.map((profile) => ({ ...profile })),
      activeId: stored.ai.activeId
    },
    library: { directory: stored.library.directory }
  }

  const source = objectOf(patch)
  if (!source) return next

  if (source.theme !== undefined) next.theme = normalizeTheme(source.theme)

  const libraryPatch = objectOf(source.library)
  if (libraryPatch && typeof libraryPatch.directory === 'string') {
    const directory = asString(libraryPatch.directory, MAX_DIRECTORY)
    if (directory && !isAbsolute(directory)) {
      throw new Error('论文库存储位置需要是绝对路径')
    }
    next.library.directory = directory
  }

  const aiPatch = objectOf(source.ai)
  if (aiPatch) {
    if (Array.isArray(aiPatch.profiles)) {
      const used = new Set<string>()
      next.ai.profiles = aiPatch.profiles
        .slice(0, MAX_PROFILES)
        .map(objectOf)
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item, index) => encodeStoredProfile(item, index, used, encodeKey))
    }
    if (typeof aiPatch.activeId === 'string') {
      next.ai.activeId = aiPatch.activeId.trim().slice(0, MAX_ID)
    }
  }

  next.ai.activeId = normalizeActiveId(next.ai.activeId, next.ai.profiles)
  return next
}
