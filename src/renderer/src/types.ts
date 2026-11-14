// 渲染进程使用的论文库类型，与主进程 / preload 中的结构保持一致

export interface Space {
  id: string
  name: string
  createdAt: number
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
  /** 标题来源：file=文件名，metadata=PDF 元数据，user=用户重命名 */
  titleSource: 'file' | 'metadata' | 'user'
  createdAt: number
}

export interface LibraryData {
  spaces: Space[]
  papers: Paper[]
}

export type AppTheme = 'light' | 'dark'

export interface AiProfile {
  id: string
  baseUrl: string
  apiKey: string
  /** 调用 OpenAI 兼容接口时使用的模型名 */
  model: string
}

export interface AiSettings {
  profiles: AiProfile[]
  /** 当前选中的配置 id，翻译和对话共用 */
  activeId: string
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatMessage {
  role: ChatRole
  content: string | null
  /** assistant 发起的工具调用 */
  tool_calls?: ChatToolCall[]
  /** tool 消息对应的调用 id */
  tool_call_id?: string
}

export type ChatFinishReason = 'stop' | 'tool_calls' | 'length' | 'aborted' | 'error'

export interface ChatToolCallResult {
  id: string
  name: string
  /** 模型返回的原始 JSON 字符串 */
  arguments: string
}

/** 一次模型请求的归一化结果 */
export interface AiChatResult {
  text: string
  toolCalls: ChatToolCallResult[]
  finishReason: ChatFinishReason
}

export type ToolRisk = 'read' | 'write' | 'destructive'

export interface ToolInfo {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  risk: ToolRisk
  exposeToAi: boolean
}

export interface ToolResult {
  content: string
  isError?: boolean
}

export type PluginPermission = 'documents:read' | 'annotations:write' | 'network' | 'storage'

export interface PluginCommand {
  id: string
  title: string
  description?: string
}

export interface PluginInfo {
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

export interface PluginIssue {
  directoryName: string
  message: string
}

export interface PluginListResult {
  plugins: PluginInfo[]
  issues: PluginIssue[]
}

/** 主进程流式返回的增量片段 */
export interface AiChunk {
  requestId: string
  delta: string
}

export interface LibrarySettings {
  /** 当前生效的论文库目录 */
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
