import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

interface PaperAnnotation {
  id: string
  type: 'highlight' | 'underline'
  color: string
  page: number
  rects: { x: number; y: number; width: number; height: number }[]
  text: string
  createdAt: number
}

type AppTheme = 'light' | 'dark'
/** BCP 47 风格的语言标签；支持的语言列表由渲染进程维护 */
type AppLanguage = string

interface UninstallResult {
  /** 用户在原生确认框中取消 */
  canceled: boolean
}

interface AiProfile {
  id: string
  baseUrl: string
  model: string
  hasApiKey: boolean
}

interface AiProfilePatch {
  id: string
  baseUrl: string
  model: string
  /** 留空表示保留已保存的 Key */
  apiKey?: string
}

interface AiSettings {
  profiles: AiProfile[]
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
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
}

interface AiChunk {
  requestId: string
  delta: string
}

interface LibrarySettings {
  directory: string
}

type KeyStorage = 'encrypted' | 'plaintext'

interface AppSettings {
  theme: AppTheme
  language: AppLanguage
  ai: AiSettings
  library: LibrarySettings
  keyStorage: KeyStorage
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
  permissions: PluginPermission[]
  commands: PluginCommand[]
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
  message?: string
}

interface RunLimits {
  maxSteps?: number
  timeoutMs?: number
}

interface RunUsage {
  steps: number
  inputTokens: number
  outputTokens: number
}

interface AgentRunInfo {
  id: string
}

interface SettingsPatch {
  theme?: AppTheme
  language?: AppLanguage
  ai?: {
    profiles?: AiProfilePatch[]
    activeId?: string
  }
  library?: {
    directory?: string
  }
}

// Custom APIs for renderer
const api = {
  importPaper: (spaceId: string | null = null) => ipcRenderer.invoke('dialog:importPaper', spaceId),
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseDirectory'),
  listPapers: () => ipcRenderer.invoke('library:list'),
  createSpace: (name: string) => ipcRenderer.invoke('library:createSpace', name),
  renameSpace: (id: string, name: string) => ipcRenderer.invoke('library:renameSpace', id, name),
  deleteSpace: (id: string) => ipcRenderer.invoke('library:deleteSpace', id),
  renamePaper: (id: string, title: string, source: 'metadata' | 'user') =>
    ipcRenderer.invoke('library:renamePaper', id, title, source),
  movePaper: (id: string, spaceId: string | null) =>
    ipcRenderer.invoke('library:movePaper', id, spaceId),
  removePaper: (id: string) => ipcRenderer.invoke('library:removePaper', id),
  readPaper: (filePath: string) => ipcRenderer.invoke('paper:read', filePath),
  listAnnotations: (filePath: string) => ipcRenderer.invoke('annotations:list', filePath),
  addAnnotation: (filePath: string, annotation: PaperAnnotation) =>
    ipcRenderer.invoke('annotations:add', filePath, annotation),
  removeAnnotations: (filePath: string, ids: string[]) =>
    ipcRenderer.invoke('annotations:remove', filePath, ids),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: SettingsPatch): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),
  clearCache: (): Promise<void> => ipcRenderer.invoke('cache:clear'),
  uninstallApp: (): Promise<UninstallResult> => ipcRenderer.invoke('app:uninstall'),
  chat: async (requestId: string, messages: ChatMessage[], profileId: string): Promise<string> => {
    const result = await ipcRenderer.invoke('ai:chat', requestId, messages, profileId)
    return result.text
  },
  chatWithTools: (
    requestId: string,
    messages: ChatMessage[],
    profileId: string,
    tools: string[] = [],
    runId?: string
  ) => ipcRenderer.invoke('ai:chat', requestId, messages, profileId, tools, runId),
  startRun: (limits: RunLimits = {}): Promise<AgentRunInfo> =>
    ipcRenderer.invoke('runs:start', limits),
  finishRun: (id: string): Promise<RunUsage> => ipcRenderer.invoke('runs:finish', id),
  cancelRun: (id: string): Promise<void> => ipcRenderer.invoke('runs:cancel', id),
  abortChat: (requestId: string): void => {
    ipcRenderer.send('ai:abort', requestId)
  },
  listTools: () => ipcRenderer.invoke('tools:list'),
  executeTool: (name: string, input: unknown) => ipcRenderer.invoke('tools:execute', name, input),
  listPlugins: (): Promise<PluginListResult> => ipcRenderer.invoke('plugins:list'),
  setPluginEnabled: (id: string, enabled: boolean): Promise<PluginInfo> =>
    ipcRenderer.invoke('plugins:setEnabled', id, enabled),
  getPluginRuntime: (): Promise<PluginRuntimeState[]> => ipcRenderer.invoke('plugins:runtime'),
  onPluginRuntime: (callback: (states: PluginRuntimeState[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, states: PluginRuntimeState[]): void => {
      callback(states)
    }
    ipcRenderer.on('plugins:runtime-changed', listener)
    return () => {
      ipcRenderer.removeListener('plugins:runtime-changed', listener)
    }
  },
  onAiChunk: (callback: (payload: AiChunk) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: AiChunk): void => {
      callback(payload)
    }
    ipcRenderer.on('ai:chunk', listener)
    return () => {
      ipcRenderer.removeListener('ai:chunk', listener)
    }
  }
}

// 只暴露最小接口；不向渲染进程开放 Electron、Node 或文件系统能力
contextBridge.exposeInMainWorld('api', api)
