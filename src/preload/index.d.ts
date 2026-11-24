declare global {
  interface SpaceInfo {
    id: string
    name: string
    createdAt: number
  }

  type PaperVenueType = 'journal' | 'conference' | 'preprint' | 'book' | 'other'
  type PaperMetadataSource = 'ai' | 'crossref' | 'mixed' | 'manual'
  type PaperMetadataField =
    | 'title'
    | 'authors'
    | 'venue'
    | 'venueType'
    | 'year'
    | 'doi'
    | 'abstract'
    | 'keywords'
    | 'summary'

  /** AI / Crossref 解析或用户手动填写的书目信息 */
  interface PaperMetadata {
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

  /** 手动编辑论文信息时提交的原始值；主进程负责校验和清洗 */
  interface PaperMetadataInput {
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

  interface PaperInfo {
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

  interface LibraryState {
    spaces: SpaceInfo[]
    papers: PaperInfo[]
  }

  interface AnnotationRect {
    // 相对页面宽高的归一化坐标（0~1）
    x: number
    y: number
    width: number
    height: number
  }

  interface PaperAnnotation {
    id: string
    type: 'highlight' | 'underline'
    color: string
    page: number
    rects: AnnotationRect[]
    text: string
    createdAt: number
  }

  type AppTheme = 'light' | 'dark'
  /** BCP 47 风格的语言标签；支持的语言列表由渲染进程维护 */
  type AppLanguage = string

  /** 接口协议：openai 走 /chat/completions，anthropic 走 /v1/messages */
  type AiProvider = 'openai' | 'anthropic'

  interface AiProfile {
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

  interface AiProfilePatch {
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

  interface AiSettings {
    profiles: AiProfile[]
    /** 当前选中的配置 id，翻译使用 */
    activeId: string
  }

  interface TranslationRequest {
    requestId: string
    source: string
    profileId: string
  }

  /** 主进程流式返回的翻译增量 */
  interface TranslationChunk {
    requestId: string
    delta: string
  }

  type PluginPermission = 'documents:read' | 'annotations:write' | 'network' | 'storage'

  interface PluginCommand {
    id: string
    title: string
    description?: string
  }

  type PluginViewLocation = 'main' | 'sidebar'

  interface PluginViewInfo {
    id: string
    title: string
    location: PluginViewLocation
    /** 相对插件目录的 HTML 入口 */
    entry: string
  }

  interface PluginInfo {
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

  interface PluginIssue {
    directoryName: string
    message: string
  }

  interface PluginListResult {
    plugins: PluginInfo[]
    issues: PluginIssue[]
  }

  type PluginRuntimeStatus = 'inactive' | 'activating' | 'active' | 'error'

  interface PluginRuntimeState {
    pluginId: string
    status: PluginRuntimeStatus
    /** 启动失败时的错误摘要 */
    message?: string
  }

  interface LibrarySettings {
    /** 当前生效的论文库目录 */
    directory: string
    /** 导入后是否自动用 AI 解析论文信息 */
    autoAnalyze: boolean
  }

  /** 系统安全存储是否可用；不可用时 Key 会明文落盘 */
  type KeyStorage = 'encrypted' | 'plaintext'

  interface AppSettings {
    theme: AppTheme
    language: AppLanguage
    ai: AiSettings
    library: LibrarySettings
    keyStorage: KeyStorage
  }

  interface SettingsPatch {
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

  interface Api {
    importPaper: (spaceId?: string | null) => Promise<PaperInfo | null>
    /** 选择论文库存储目录；取消时返回 null */
    chooseDirectory: () => Promise<string | null>
    listPapers: () => Promise<LibraryState>
    createSpace: (name: string) => Promise<LibraryState>
    renameSpace: (id: string, name: string) => Promise<LibraryState>
    deleteSpace: (id: string) => Promise<LibraryState>
    renamePaper: (id: string, title: string, source: 'metadata' | 'user') => Promise<LibraryState>
    movePaper: (id: string, spaceId: string | null) => Promise<LibraryState>
    /** 收藏 / 取消收藏论文 */
    setPaperFavorite: (id: string, favorite: boolean) => Promise<LibraryState>
    removePaper: (id: string) => Promise<LibraryState>
    /** 用 AI 解析论文信息，并用 Crossref 校验补全；返回更新后的论文 */
    analyzePaper: (id: string, options?: { useWeb?: boolean }) => Promise<PaperInfo>
    /** 手动添加或修改论文信息；返回更新后的论文 */
    updatePaperMetadata: (id: string, metadata: PaperMetadataInput) => Promise<PaperInfo>
    readPaper: (filePath: string) => Promise<Uint8Array>
    listAnnotations: (filePath: string) => Promise<PaperAnnotation[]>
    addAnnotation: (filePath: string, annotation: PaperAnnotation) => Promise<PaperAnnotation>
    removeAnnotations: (filePath: string, ids: string[]) => Promise<string[]>
    getSettings: () => Promise<AppSettings>
    updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
    /** 清理 Electron 的 HTTP、代码和 DNS 缓存；不影响书库、标注或设置 */
    clearCache: () => Promise<void>
    /** 卸载应用：删除本地论文、标注、设置、API Key 和插件并退出；调用方负责先确认 */
    uninstallApp: () => Promise<void>
    /** 启动翻译进程；活动栏点击时调用，启动后常驻到应用退出 */
    activateTranslation: () => Promise<void>
    /** 翻译一段选区文本，返回完整译文；增量通过 onTranslationChunk 推送 */
    translate: (request: TranslationRequest) => Promise<string>
    /** 中止指定翻译请求 */
    abortTranslation: (requestId: string) => void
    /** 订阅翻译增量，返回取消订阅函数 */
    onTranslationChunk: (callback: (payload: TranslationChunk) => void) => () => void
    /** 列出已发现插件和 manifest 问题 */
    listPlugins: () => Promise<PluginListResult>
    /** 启用或关闭插件；不兼容的插件会被主进程拒绝 */
    setPluginEnabled: (id: string, enabled: boolean) => Promise<PluginInfo>
    /** 已启用插件的扩展宿主状态 */
    getPluginRuntime: () => Promise<PluginRuntimeState[]>
    /** 插件 iframe 的受限能力请求；只支持 tools.list / tools.execute */
    pluginViewRequest: (
      pluginId: string,
      viewId: string,
      method: string,
      params?: unknown
    ) => Promise<unknown>
    /** 订阅宿主状态变化，返回取消订阅函数 */
    onPluginRuntime: (callback: (states: PluginRuntimeState[]) => void) => () => void
  }

  interface Window {
    /** 平台暴露给渲染进程的全部能力；不包含 Electron/Node API */
    api: Api | undefined
  }
}

export {}
