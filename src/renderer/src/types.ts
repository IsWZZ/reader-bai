// 渲染进程使用的论文库类型，与主进程 / preload 中的结构保持一致

export interface Space {
  id: string
  name: string
  createdAt: number
}

export type PaperVenueType = 'journal' | 'conference' | 'preprint' | 'book' | 'other'
export type PaperMetadataSource = 'ai' | 'crossref' | 'mixed' | 'manual'
export type PaperMetadataField =
  'title' | 'authors' | 'venue' | 'venueType' | 'year' | 'doi' | 'abstract' | 'keywords' | 'summary'

/** AI / Crossref 解析或用户手动填写的书目信息 */
export interface PaperMetadata {
  title?: string
  authors: string[]
  venue?: string
  venueType?: PaperVenueType
  year?: number
  doi?: string
  abstract?: string
  keywords: string[]
  /** AI 生成的一段简短概括 */
  summary?: string
  source: PaperMetadataSource
  analyzedAt: number
  /** 用户手动设置过的字段；重新解析时保留用户值 */
  manualFields?: PaperMetadataField[]
}

/** 手动编辑论文信息时提交的原始值 */
export interface PaperMetadataInput {
  title?: string
  authors?: string[]
  venue?: string
  venueType?: PaperVenueType | null
  year?: number | string | null
  doi?: string | null
  abstract?: string
  keywords?: string[]
  summary?: string
}

export interface Paper {
  id: string
  /** 展示名称，用户可重命名 */
  title: string
  /** 论文库中保存的绝对路径（可能是导入时复制出的副本） */
  path: string
  /** 导入时的原始路径，用于重复导入去重 */
  sourcePath?: string
  /** 原始文件名（含扩展名） */
  fileName: string
  /** 所属空间，null 表示未分类 */
  spaceId: string | null
  /** 标题来源：file=文件名，metadata=PDF 元数据或 AI 解析，user=用户重命名 */
  titleSource: 'file' | 'metadata' | 'user'
  createdAt: number
  /** 是否收藏；收藏的论文在所属空间内置顶 */
  favorite?: boolean
  /** AI / Crossref 解析出的书目信息 */
  metadata?: PaperMetadata
}

export interface LibraryData {
  spaces: Space[]
  papers: Paper[]
}

export type AppTheme = 'light' | 'dark'

/** BCP 47 风格的语言标签；实际支持的语言由 lib/i18n 的 locale 注册表决定 */
export type AppLanguage = string

/** 接口协议：openai 走 /chat/completions，anthropic 走 /v1/messages */
export type AiProvider = 'openai' | 'anthropic'

export interface AiProfile {
  id: string
  provider: AiProvider
  baseUrl: string
  /** 服务商提供的模型名 */
  model: string
  /** 是否已在主进程保存 Key；渲染进程拿不到 Key 本身 */
  hasApiKey: boolean
  /** 禁用后不会被选中，也不能发起请求 */
  enabled: boolean
}

export interface AiProfilePatch {
  id: string
  /** 省略时沿用该 id 原有的协议 */
  provider?: AiProvider
  baseUrl: string
  model: string
  /** 留空或省略时保留该 id 已保存的 Key；新增配置必须填写 */
  apiKey?: string
  /** 是否启用；保存整份配置列表时必须显式提供 */
  enabled: boolean
}

export interface AiSettings {
  profiles: AiProfile[]
  /** 当前选中的配置 id，翻译使用 */
  activeId: string
}

export interface TranslationRequest {
  requestId: string
  source: string
  profileId: string
}

/** 主进程流式返回的翻译增量 */
export interface TranslationChunk {
  requestId: string
  delta: string
}

export type PluginPermission = 'documents:read' | 'annotations:write' | 'network' | 'storage'

export interface PluginCommand {
  id: string
  title: string
  description?: string
}

export type PluginViewLocation = 'main' | 'sidebar'

export interface PluginViewInfo {
  id: string
  title: string
  location: PluginViewLocation
  /** 相对插件目录的 HTML 入口 */
  entry: string
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  description?: string
  /** manifest 中声明的权限，不代表已经授予 */
  permissions: PluginPermission[]
  commands: PluginCommand[]
  views: PluginViewInfo[]
  /** 用户已启用且与当前宿主版本兼容 */
  enabled: boolean
  compatible: boolean
}

export interface PluginIssue {
  directoryName: string
  message: string
}

export interface PluginListResult {
  plugins: PluginInfo[]
  issues: PluginIssue[]
}

export type PluginRuntimeStatus = 'inactive' | 'activating' | 'active' | 'error'

export interface PluginRuntimeState {
  pluginId: string
  status: PluginRuntimeStatus
  /** 启动失败时的错误摘要 */
  message?: string
}

export interface LibrarySettings {
  /** 当前生效的论文库目录 */
  directory: string
  /** 导入后是否自动用 AI 解析论文信息 */
  autoAnalyze: boolean
}

/** 系统安全存储是否可用；不可用时 Key 会明文落盘 */
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
    /** 传入时整体替换配置列表；未提供 apiKey 的配置保留原 Key */
    profiles?: AiProfilePatch[]
    /** 只切换当前配置 */
    activeId?: string
  }
  library?: {
    /** 空字符串表示恢复默认目录 */
    directory?: string
    /** 导入后自动解析论文信息 */
    autoAnalyze?: boolean
  }
}
