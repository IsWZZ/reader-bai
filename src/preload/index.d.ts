import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface SpaceInfo {
    id: string
    name: string
    createdAt: number
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
    /** 标题来源：file=文件名，metadata=PDF 元数据，user=用户重命名 */
    titleSource: 'file' | 'metadata' | 'user'
    createdAt: number
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

  interface AiProfile {
    id: string
    baseUrl: string
    apiKey: string
    /** 调用 OpenAI 兼容接口时使用的模型名 */
    model: string
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

  type ChatFinishReason = 'stop' | 'tool_calls' | 'length' | 'aborted' | 'error'

  interface ChatToolCallResult {
    id: string
    name: string
    /** 模型返回的原始 JSON 字符串 */
    arguments: string
  }

  /** 一次模型请求的归一化结果 */
  interface AiChatResult {
    text: string
    toolCalls: ChatToolCallResult[]
    finishReason: ChatFinishReason
  }

  /** 主进程流式返回的增量片段 */
  interface AiChunk {
    requestId: string
    delta: string
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
  }

  interface ToolResult {
    content: string
    isError?: boolean
  }

  interface LibrarySettings {
    /** 当前生效的论文库目录 */
    directory: string
  }

  interface AppSettings {
    theme: AppTheme
    ai: AiSettings
    library: LibrarySettings
  }

  interface SettingsPatch {
    theme?: AppTheme
    ai?: {
      /** 传入时整体替换配置列表 */
      profiles?: AiProfile[]
      /** 只切换当前配置 */
      activeId?: string
    }
    library?: {
      /** 空字符串表示恢复默认目录 */
      directory?: string
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
    removePaper: (id: string) => Promise<LibraryState>
    readPaper: (filePath: string) => Promise<Uint8Array>
    listAnnotations: (filePath: string) => Promise<PaperAnnotation[]>
    addAnnotation: (filePath: string, annotation: PaperAnnotation) => Promise<PaperAnnotation>
    removeAnnotations: (filePath: string, ids: string[]) => Promise<string[]>
    getSettings: () => Promise<AppSettings>
    updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
    /** 使用指定 AI 配置发起流式对话，返回完整回复文本；增量通过 onAiChunk 推送 */
    chat: (requestId: string, messages: ChatMessage[], profileId: string) => Promise<string>
    /** 带工具定义的流式对话，返回归一化后的文本和工具调用 */
    chatWithTools: (
      requestId: string,
      messages: ChatMessage[],
      profileId: string,
      tools?: string[]
    ) => Promise<AiChatResult>
    /** 中止指定请求 */
    abortChat: (requestId: string) => void
    /** 订阅流式增量，返回取消订阅函数 */
    onAiChunk: (callback: (payload: AiChunk) => void) => () => void
    /** 列出平台注册的工具 */
    listTools: () => Promise<ToolInfo[]>
    /** 执行一个已注册工具；写操作由主进程弹出确认 */
    executeTool: (name: string, input: unknown) => Promise<ToolResult>
  }

  interface Window {
    electron: ElectronAPI
    api: Api | undefined
  }
}
