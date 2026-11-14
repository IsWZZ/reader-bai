import { ipcMain } from 'electron'
import type { AgentRuntime } from '../agent/runtime'

/**
 * agent 会话 IPC。渲染进程只负责发起和取消；
 * 循环、模型请求、工具执行和预算都在主进程 / agent 宿主一侧。
 */
export const registerAgentIpc = (runtime: AgentRuntime): void => {
  ipcMain.handle('agent:start', (event, request: unknown) => runtime.start(event.sender, request))
  ipcMain.handle('agent:cancel', (_event, id: unknown) => runtime.cancel(id))
}
