import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { createTranslationApi } from '../modules/translation/preload/api'

interface PaperAnnotation {
  id: string
  type: 'highlight' | 'underline'
  color: string
  page: number
  rects: { x: number; y: number; width: number; height: number }[]
  text: string
  createdAt: number
}

/** 手动编辑论文信息时提交的原始值；校验在主进程 */
interface PaperMetadataInput {
  title?: string
  authors?: string[]
  venue?: string
  venueType?: 'journal' | 'conference' | 'preprint' | 'book' | 'other' | null
  year?: number | string | null
  doi?: string | null
  abstract?: string
  keywords?: string[]
  summary?: string
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
  model: string
  hasApiKey: boolean
  enabled: boolean
}

interface AiProfilePatch {
  id: string
  /** 省略时沿用该 id 原有的协议 */
  provider?: AiProvider
  baseUrl: string
  model: string
  /** 留空表示保留已保存的 Key */
  apiKey?: string
  /** 是否启用；保存整份配置列表时必须显式提供 */
  enabled: boolean
}

interface AiSettings {
  profiles: AiProfile[]
  activeId: string
}

interface LibrarySettings {
  directory: string
  autoAnalyze: boolean
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

type PluginViewLocation = 'main' | 'sidebar'

interface PluginViewInfo {
  id: string
  title: string
  location: PluginViewLocation
  entry: string
}

interface PluginInfo {
  id: string
  name: string
  version: string
  description?: string
  permissions: PluginPermission[]
  commands: PluginCommand[]
  views: PluginViewInfo[]
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

interface SettingsPatch {
  theme?: AppTheme
  language?: AppLanguage
  ai?: {
    profiles?: AiProfilePatch[]
    activeId?: string
  }
  library?: {
    directory?: string
    autoAnalyze?: boolean
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
  setPaperFavorite: (id: string, favorite: boolean) =>
    ipcRenderer.invoke('library:setFavorite', id, favorite),
  removePaper: (id: string) => ipcRenderer.invoke('library:removePaper', id),
  analyzePaper: (id: string, options?: { useWeb?: boolean }) =>
    ipcRenderer.invoke('library:analyzePaper', id, options),
  updatePaperMetadata: (id: string, metadata: PaperMetadataInput) =>
    ipcRenderer.invoke('library:updatePaperMetadata', id, metadata),
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
  uninstallApp: (): Promise<void> => ipcRenderer.invoke('app:uninstall'),
  ...createTranslationApi(ipcRenderer),
  listPlugins: (): Promise<PluginListResult> => ipcRenderer.invoke('plugins:list'),
  setPluginEnabled: (id: string, enabled: boolean): Promise<PluginInfo> =>
    ipcRenderer.invoke('plugins:setEnabled', id, enabled),
  getPluginRuntime: (): Promise<PluginRuntimeState[]> => ipcRenderer.invoke('plugins:runtime'),
  pluginViewRequest: (pluginId: string, viewId: string, method: string, params?: unknown) =>
    ipcRenderer.invoke('plugins:view-request', pluginId, viewId, method, params),
  onPluginRuntime: (callback: (states: PluginRuntimeState[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, states: PluginRuntimeState[]): void => {
      callback(states)
    }
    ipcRenderer.on('plugins:runtime-changed', listener)
    return () => {
      ipcRenderer.removeListener('plugins:runtime-changed', listener)
    }
  }
}

// 只暴露最小接口；不向渲染进程开放 Electron、Node 或文件系统能力
contextBridge.exposeInMainWorld('api', api)
