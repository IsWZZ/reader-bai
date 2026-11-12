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

  type AppTheme = 'light' | 'dark' | 'system'

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

  type ChatRole = 'system' | 'user' | 'assistant'

  interface ChatMessage {
    role: ChatRole
    content: string
  }

  /** 主进程流式返回的增量片段 */
  interface AiChunk {
    requestId: string
    delta: string
  }

  interface AppSettings {
    theme: AppTheme
    ai: AiSettings
  }

  interface SettingsPatch {
    theme?: AppTheme
    ai?: {
      /** 传入时整体替换配置列表 */
      profiles?: AiProfile[]
      /** 只切换当前配置 */
      activeId?: string
    }
  }

  interface Api {
    importPaper: (spaceId?: string | null) => Promise<PaperInfo | null>
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
    /** 中止指定请求 */
    abortChat: (requestId: string) => void
    /** 订阅流式增量，返回取消订阅函数 */
    onAiChunk: (callback: (payload: AiChunk) => void) => () => void
  }

  interface Window {
    electron: ElectronAPI
    api: Api | undefined
  }
}
