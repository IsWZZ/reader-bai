import { contextBridge, ipcRenderer } from 'electron'
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

type AppTheme = 'light' | 'dark' | 'system'

interface AiSettings {
  baseUrl: string
  apiKey: string
}

interface AppSettings {
  theme: AppTheme
  ai: AiSettings
}

interface SettingsPatch {
  theme?: AppTheme
  ai?: AiSettings
}

// Custom APIs for renderer
const api = {
  importPaper: (spaceId: string | null = null) => ipcRenderer.invoke('dialog:importPaper', spaceId),
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
    ipcRenderer.invoke('settings:update', patch)
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
