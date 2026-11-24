import type { IpcRenderer, IpcRendererEvent } from 'electron'

export interface TranslationRequest {
  requestId: string
  source: string
  profileId: string
}

/** 主进程流式返回的翻译增量 */
export interface TranslationChunk {
  requestId: string
  delta: string
}

export interface TranslationApi {
  activateTranslation: () => Promise<void>
  translate: (request: TranslationRequest) => Promise<string>
  abortTranslation: (requestId: string) => void
  onTranslationChunk: (callback: (payload: TranslationChunk) => void) => () => void
}

/**
 * 翻译模块的 preload 桥接方法。
 * 只做窄方法转发，不做参数校验、不碰 Key；`src/preload/index.ts` 仍是唯一暴露入口。
 */
export const createTranslationApi = (ipcRenderer: IpcRenderer): TranslationApi => ({
  activateTranslation: () => ipcRenderer.invoke('translation:activate'),
  translate: (request) => ipcRenderer.invoke('translation:translate', request),
  abortTranslation: (requestId) => {
    ipcRenderer.send('translation:abort', requestId)
  },
  onTranslationChunk: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: TranslationChunk): void => {
      callback(payload)
    }
    ipcRenderer.on('translation:chunk', listener)
    return () => {
      ipcRenderer.removeListener('translation:chunk', listener)
    }
  }
})
