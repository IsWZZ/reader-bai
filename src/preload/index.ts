import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  importPaper: () => ipcRenderer.invoke('dialog:importPaper'),
  listPapers: () => ipcRenderer.invoke('library:list')
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
