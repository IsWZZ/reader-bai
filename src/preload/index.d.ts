declare global {
  interface SpaceInfo {
    id: string
    name: string
    createdAt: number
  }

  type PaperVenueType = 'journal' | 'conference' | 'preprint' | 'book' | 'other'
  type PaperMetadataSource = 'ai' | 'crossref' | 'mixed'

  /** AI / Crossref 解析出的书目信息 */
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
  }

  interface AiProfilePatch {
    id: string
    /** 省略时沿用该 id 原有的协议 */
    provider?: AiProvider
    baseUrl: string
    model: string
    /** 留空或省略时保留该 id 已保存的 Key；新增配置必须填写 */
    apiKey?: string
  }

  interface AiSettings {
    profiles: AiProfile[]
    /** 当前选中的配置 id，翻译和对话共用 */
    activeId: string
  }

  type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

  interface ChatToolCall {
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }

  interface ChatMessage {
    role: ChatRole
    content: string | null
    /** assistant 发起的工具调用 */
    tool_calls?: ChatToolCall[]
    /** tool 消息对应的调用 id */
    tool_call_id?: string
  }

  /** 主进程流式返回的增量片段 */
  interface AiChunk {
    requestId: string
    delta: string
  }

  type AgentMode = 'chat' | 'agent'

  interface AgentStartRequest {
    messages: ChatMessage[]
    profileId: string
    mode: AgentMode
  }

  interface AgentSessionInfo {
    id: string
  }

  type AgentFinishReason = 'stop' | 'max-steps' | 'aborted'

  type AgentEvent =
    | { type: 'chunk'; delta: string }
    | { type: 'tool-call'; callId: string; name: string }
    | { type: 'tool-result'; callId: string; name: string; content: string }
    | { type: 'tool-error'; callId: string; name: string; error: string }
    | { type: 'done'; text: string; steps: number; finishReason: AgentFinishReason }
    | { type: 'error'; message: string }

  interface AgentEventPayload {
    sessionId: string
    event: AgentEvent
  }

  type ToolRisk = 'read' | 'write' | 'destructive'

  interface ToolInfo {
    name: string
    title: string
    description: string
    /** 供模型/UI 展示的 JSON Schema */
    inputSchema: Record<string, unknown>
    risk: ToolRisk
    /** 是否允许 agent 调用 */
    exposeToAi: boolean
    /** 插件调用该工具所需的 manifest 权限 */
    requiredPermissions?: string[]
  }

  interface ToolResult {
    content: string
    isError?: boolean
  }

  type PluginPermission = 'documents:read' | 'annotations:write' | 'network' | 'storage'

  interface PluginCommand {
    id: string
    title: string
    description?: string
  }

  interface PluginInfo {
    id: string
    name: string
    version: string
    description?: string
    /** manifest 中声明的权限，不代表已经授予 */
    permissions: PluginPermission[]
    commands: PluginCommand[]
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

  interface UninstallResult {
    /** 用户在原生确认框中取消 */
    canceled: boolean
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
    removePaper: (id: string) => Promise<LibraryState>
    /** 用 AI 解析论文信息，并用 Crossref 校验补全；返回更新后的论文 */
    analyzePaper: (id: string, options?: { useWeb?: boolean }) => Promise<PaperInfo>
    readPaper: (filePath: string) => Promise<Uint8Array>
    listAnnotations: (filePath: string) => Promise<PaperAnnotation[]>
    addAnnotation: (filePath: string, annotation: PaperAnnotation) => Promise<PaperAnnotation>
    removeAnnotations: (filePath: string, ids: string[]) => Promise<string[]>
    getSettings: () => Promise<AppSettings>
    updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
    /** 清理 Electron 的 HTTP、代码和 DNS 缓存；不影响书库、标注或设置 */
    clearCache: () => Promise<void>
    /** 卸载应用：原生确认后删除本地论文、标注、设置、API Key 和插件并退出 */
    uninstallApp: () => Promise<UninstallResult>
    /** 单次流式对话（翻译），返回完整文本；增量通过 onAiChunk 推送 */
    chat: (requestId: string, messages: ChatMessage[], profileId: string) => Promise<string>
    /** 中止指定请求 */
    abortChat: (requestId: string) => void
    /** 订阅流式增量，返回取消订阅函数 */
    onAiChunk: (callback: (payload: AiChunk) => void) => () => void
    /** 启动一次 agent 会话；循环运行在独立进程中，这里只返回会话 id */
    startAgent: (request: AgentStartRequest) => Promise<AgentSessionInfo>
    /** 取消 agent 会话 */
    cancelAgent: (sessionId: string) => Promise<void>
    /** 订阅 agent 会话事件（增量、工具调用、结束和错误） */
    onAgentEvent: (callback: (payload: AgentEventPayload) => void) => () => void
    /** 列出平台注册的工具 */
    listTools: () => Promise<ToolInfo[]>
    /** 执行一个已注册工具；写操作由主进程弹出确认 */
    executeTool: (name: string, input: unknown) => Promise<ToolResult>
    /** 列出已发现插件和 manifest 问题 */
    listPlugins: () => Promise<PluginListResult>
    /** 启用或关闭插件；不兼容的插件会被主进程拒绝 */
    setPluginEnabled: (id: string, enabled: boolean) => Promise<PluginInfo>
    /** 已启用插件的扩展宿主状态 */
    getPluginRuntime: () => Promise<PluginRuntimeState[]>
    /** 订阅宿主状态变化，返回取消订阅函数 */
    onPluginRuntime: (callback: (states: PluginRuntimeState[]) => void) => () => void
  }

  interface Window {
    /** 平台暴露给渲染进程的全部能力；不包含 Electron/Node API */
    api: Api | undefined
  }
}

export {}
