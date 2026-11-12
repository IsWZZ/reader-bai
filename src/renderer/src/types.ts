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
  /** 论文在磁盘上的绝对路径 */
  path: string
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

export type AppTheme = 'light' | 'dark' | 'system'

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

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

/** 主进程流式返回的增量片段 */
export interface AiChunk {
  requestId: string
  delta: string
}

export interface AppSettings {
  theme: AppTheme
  ai: AiSettings
}

export interface SettingsPatch {
  theme?: AppTheme
  ai?: {
    /** 传入时整体替换配置列表 */
    profiles?: AiProfile[]
    /** 只切换当前配置 */
    activeId?: string
  }
}
