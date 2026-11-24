import { ipcMain } from 'electron'
import type { TranslationRuntime } from './runtime'

/**
 * 翻译 IPC。渲染进程只负责激活进程、提交选区和取消；
 * 系统提示词、会话和模型请求都在翻译宿主 / 主进程一侧。
 */
export const registerTranslationIpc = (runtime: TranslationRuntime): void => {
  ipcMain.handle('translation:activate', () => runtime.activate())
  ipcMain.handle('translation:translate', (event, request: unknown) =>
    runtime.translate(event.sender, request)
  )
  ipcMain.on('translation:abort', (_event, requestId: unknown) => runtime.abort(requestId))
}
