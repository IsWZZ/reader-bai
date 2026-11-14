// 设置文件的纯逻辑：清洗与 patch 合并。
// 刻意不依赖 electron，方便在 Vitest 中直接测试。

import { isAbsolute } from 'node:path'

export type AppTheme = 'light' | 'dark'

/**
 * 界面语言使用 BCP 47 风格的语言标签，具体支持哪些语言由渲染进程的 locale 注册表决定。
 * 主进程只做格式校验，这样以后增加语言不需要改设置文件的读写逻辑。
 */
export type AppLanguage = string

/**
 * 接口协议。openai 走 OpenAI 兼容的 /chat/completions，
 * anthropic 走 Anthropic Messages API 的 /v1/messages。
 */
export type AiProvider = 'openai' | 'anthropic'

/** 传给主进程的配置补丁；apiKey 为空表示保留该 id 已保存的 Key */
export interface AiProfilePatch {
  id: string
  provider?: AiProvider
  baseUrl: string
  model: string
  apiKey?: string
  /** 省略时沿用该 id 原有状态；新增配置默认启用 */
  enabled?: boolean
}

/** 回给渲染进程的配置：永不包含明文或密文 Key */
export interface PublicAiProfile {
  id: string
  provider: AiProvider
  baseUrl: string
  model: string
  hasApiKey: boolean
  /** 禁用的配置不能被选中，也不能发起请求 */
  enabled: boolean
}

export interface AiSettings {
  profiles: PublicAiProfile[]
  activeId: string
}

export interface LibrarySettings {
  /** 论文库目录；空字符串表示使用主进程提供的默认目录 */
  directory: string
  /** 导入后是否自动用 AI 解析论文信息；默认开启 */
  autoAnalyze: boolean
}

/** 系统安全存储是否可用；不可用时 Key 会明文落盘，需要在设置页提示 */
export type KeyStorage = 'encrypted' | 'plaintext'

export interface AppSettings {
  theme: AppTheme
  language: AppLanguage
  ai: AiSettings
  library: LibrarySettings
  keyStorage: KeyStorage
}

export interface SettingsPatch {
  theme?: AppTheme
  language?: AppLanguage
  ai?: {
    profiles?: AiProfilePatch[]
    activeId?: string
  }
  library?: {
    /** 空字符串表示恢复默认目录 */
    directory?: string
    /** 导入后自动解析论文信息 */
    autoAnalyze?: boolean
  }
}

// 磁盘上的形式：每条配置的 API Key 优先用系统钥匙串加密
export interface StoredAiProfile {
  id: string
  provider: AiProvider
  baseUrl: string
  apiKey: string
  apiKeyEncrypted: boolean
  model: string
  /** 禁用后平台不会再用该配置发起请求 */
  enabled: boolean
}

export interface StoredAiSettings {
  profiles: StoredAiProfile[]
  activeId: string
}

export interface StoredSettings {
  theme: AppTheme
  language: AppLanguage
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
const MAX_LANGUAGE = 35
const DEFAULT_LANGUAGE = 'zh'
// 形如 zh、en、zh-Hans、pt-BR；只保留语言标签字符，避免写入任意字符串
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i
// safeStorage 的密文是 base64，长度会明显超过明文
const MAX_STORED_KEY = 4096
const MAX_MODEL = 120
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * AI 服务地址只允许 HTTPS；本机模型服务允许 HTTP。
 * 这条规则同时用于保存和发起请求，避免把 Key 发到明文连接。
 */
export const isAllowedAiBaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    return LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

export const AI_BASE_URL_ERROR =
  'Base URL 需要是 HTTPS 地址；本机服务可以使用 http://localhost 或 http://127.0.0.1'

// 旧版本的 'system' 等已移除，读取时按浅色处理
const normalizeTheme = (value: unknown): AppTheme =>
  value === 'light' || value === 'dark' ? value : 'light'

/** 旧设置没有 provider；未知值一律回退到 OpenAI 兼容接口 */
const normalizeProvider = (value: unknown): AiProvider =>
  value === 'anthropic' ? 'anthropic' : 'openai'

const asString = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/** 缺失、格式不合法或尚未支持的语言统一回退到中文 */
const normalizeLanguage = (value: unknown): AppLanguage => {
  const language = asString(value, MAX_LANGUAGE)
  return LANGUAGE_PATTERN.test(language) ? language : DEFAULT_LANGUAGE
}

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

/** activeId 只能指向已启用的配置；全部禁用时返回空字符串 */
const normalizeActiveId = (value: unknown, profiles: StoredAiProfile[]): string => {
  const id = asString(value, MAX_ID)
  const active = profiles.find((profile) => profile.id === id)
  if (active?.enabled) return id
  return profiles.find((profile) => profile.enabled)?.id ?? ''
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
    provider: normalizeProvider(raw.provider),
    baseUrl: asString(raw.baseUrl, MAX_BASE_URL),
    apiKey,
    apiKeyEncrypted: encrypted && apiKey !== '',
    model: asString(raw.model, MAX_MODEL),
    // 旧设置没有该字段，默认启用
    enabled: raw.enabled !== false
  }
}

export const normalizeStoredSettings = (raw: unknown): StoredSettings => {
  const source = objectOf(raw) ?? {}
  const ai = objectOf(source.ai) ?? {}

  const used = new Set<string>()
  const profiles = (Array.isArray(ai.profiles) ? ai.profiles : [])
    .slice(0, MAX_PROFILES)
    .map(objectOf)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item, index) => normalizeStoredProfile(item, index, used))

  const library = objectOf(source.library) ?? {}

  return {
    theme: normalizeTheme(source.theme),
    language: normalizeLanguage(source.language),
    ai: { profiles, activeId: normalizeActiveId(ai.activeId, profiles) },
    library: {
      directory: normalizeDirectory(library.directory),
      // 旧设置没有该字段，保持默认开启
      autoAnalyze: library.autoAnalyze !== false
    }
  }
}

export interface AiBaseUrlChange {
  id: string
  from: string
  to: string
}

const urlOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * 找出“已有 API Key 的配置改了服务地址”的条目。
 * 只有 origin（协议、主机、端口）变化才会改变 Key 的去向，路径变化不算。
 * 主进程据此在保存前弹出原生确认，避免被攻破的渲染进程把 Key 引到别处。
 */
export const findBaseUrlChanges = (stored: StoredSettings, patch: unknown): AiBaseUrlChange[] => {
  const source = objectOf(patch)
  const aiPatch = source ? objectOf(source.ai) : null
  if (!aiPatch || !Array.isArray(aiPatch.profiles)) return []

  const existing = new Map(stored.ai.profiles.map((profile) => [profile.id, profile]))
  const used = new Set<string>()
  const changes: AiBaseUrlChange[] = []
  const raws = aiPatch.profiles
    .slice(0, MAX_PROFILES)
    .map(objectOf)
    .filter((item): item is Record<string, unknown> => item !== null)

  raws.forEach((raw, index) => {
    const id = normalizeId(raw.id, index, used)
    const previous = existing.get(id)
    if (!previous || !previous.apiKey) return

    const nextUrl = asString(raw.baseUrl, MAX_BASE_URL)
    if (nextUrl === previous.baseUrl) return
    const previousOrigin = urlOrigin(previous.baseUrl)
    const nextOrigin = urlOrigin(nextUrl)
    if (previousOrigin !== null && previousOrigin === nextOrigin) return

    changes.push({ id, from: previous.baseUrl, to: nextUrl })
  })

  return changes
}

const encodeStoredProfile = (
  raw: Record<string, unknown>,
  index: number,
  used: Set<string>,
  existing: Map<string, StoredAiProfile>,
  encodeKey: EncodeApiKey
): StoredAiProfile => {
  const id = normalizeId(raw.id, index, used)
  const baseUrl = asString(raw.baseUrl, MAX_BASE_URL)
  if (baseUrl && !isAllowedAiBaseUrl(baseUrl)) throw new Error(AI_BASE_URL_ERROR)

  const plainKey = asString(raw.apiKey, MAX_API_KEY)
  const previous = existing.get(id)
  // 回传的配置不含 Key：留空表示沿用该 id 已保存的 Key
  const encoded = plainKey
    ? encodeKey(plainKey)
    : previous
      ? { apiKey: previous.apiKey, apiKeyEncrypted: previous.apiKeyEncrypted }
      : { apiKey: '', apiKeyEncrypted: false }

  return {
    id,
    // 未显式提供时沿用该 id 原有的协议，避免老调用方把 Anthropic 配置改回 OpenAI
    provider:
      raw.provider === undefined
        ? (previous?.provider ?? 'openai')
        : normalizeProvider(raw.provider),
    baseUrl,
    apiKey: encoded.apiKey,
    apiKeyEncrypted: encoded.apiKeyEncrypted && encoded.apiKey !== '',
    model: asString(raw.model, MAX_MODEL),
    // 未显式提供时沿用原状态，避免编辑 Base URL/模型时意外重新启用
    enabled: raw.enabled === undefined ? (previous?.enabled ?? true) : raw.enabled === true
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
    language: stored.language,
    ai: {
      profiles: stored.ai.profiles.map((profile) => ({ ...profile })),
      activeId: stored.ai.activeId
    },
    library: {
      directory: stored.library.directory,
      autoAnalyze: stored.library.autoAnalyze
    }
  }

  const source = objectOf(patch)
  if (!source) return next

  if (source.theme !== undefined) next.theme = normalizeTheme(source.theme)
  if (source.language !== undefined) next.language = normalizeLanguage(source.language)

  const libraryPatch = objectOf(source.library)
  if (libraryPatch && typeof libraryPatch.directory === 'string') {
    const directory = asString(libraryPatch.directory, MAX_DIRECTORY)
    if (directory && !isAbsolute(directory)) {
      throw new Error('论文库存储位置需要是绝对路径')
    }
    next.library.directory = directory
  }
  if (libraryPatch && typeof libraryPatch.autoAnalyze === 'boolean') {
    next.library.autoAnalyze = libraryPatch.autoAnalyze
  }

  const aiPatch = objectOf(source.ai)
  if (aiPatch) {
    if (Array.isArray(aiPatch.profiles)) {
      const used = new Set<string>()
      const existing = new Map(stored.ai.profiles.map((profile) => [profile.id, profile]))
      next.ai.profiles = aiPatch.profiles
        .slice(0, MAX_PROFILES)
        .map(objectOf)
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item, index) => encodeStoredProfile(item, index, used, existing, encodeKey))
    }
    if (typeof aiPatch.activeId === 'string') {
      next.ai.activeId = aiPatch.activeId.trim().slice(0, MAX_ID)
    }
  }

  next.ai.activeId = normalizeActiveId(next.ai.activeId, next.ai.profiles)
  return next
}
