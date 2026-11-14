import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

interface AiProfile {
  id: string
  baseUrl: string
  apiKey: string
  model: string
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

interface AppSettings {
  theme: AppTheme
  ai: AiSettings
  library: LibrarySettings
}

interface SettingsPatch {
  theme?: AppTheme
  ai?: {
    profiles?: AiProfile[]
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
  chat: async (requestId: string, messages: ChatMessage[], profileId: string): Promise<string> => {
    const result = await ipcRenderer.invoke('ai:chat', requestId, messages, profileId)
    return result.text
  },
  chatWithTools: (
    requestId: string,
    messages: ChatMessage[],
    profileId: string,
    tools: string[] = []
  ) => ipcRenderer.invoke('ai:chat', requestId, messages, profileId, tools),
  abortChat: (requestId: string): void => {
    ipcRenderer.send('ai:abort', requestId)
  },
  listTools: () => ipcRenderer.invoke('tools:list'),
  executeTool: (name: string, input: unknown) => ipcRenderer.invoke('tools:execute', name, input),
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

console.log('preload script running, contextIsolated:', process.contextIsolated)

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    console.log('api exposed via contextBridge')
  } catch (error) {
    console.error('contextBridge error:', error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  console.log('api exposed via window assignment')
}
