import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ToolInvocation, ToolRegistry } from '../tool-registry'

const MAX_TOOL_NAME_LENGTH = 100
const MAX_INPUT_CHARS = 100_000
const MAX_DETAIL_CHARS = 500

const summarizeInput = (input: unknown): string => {
  try {
    const text = JSON.stringify(input)
    if (!text) return '（无参数）'
    return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}…` : text
  } catch {
    return '（无法展示参数）'
  }
}

/** 写操作在执行前的确认弹窗；由主进程持有，插件无法跳过 */
export const confirmToolInvocation = async (invocation: ToolInvocation): Promise<boolean> => {
  const requester =
    invocation.context.source === 'plugin' ? `插件 ${invocation.context.pluginId ?? '未知'}` : 'AI'
  const options = {
    type: 'warning' as const,
    buttons: ['取消', '允许'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: '需要确认',
    message: `${requester} 请求执行：${invocation.tool.title}`,
    detail: `工具：${invocation.tool.name}\n参数：${summarizeInput(invocation.input)}`
  }
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

/**
 * 工具执行边界：渲染进程只能按名字调用已注册工具，
 * 参数校验、AI 暴露白名单和写操作确认都由主进程完成。
 */
export const registerToolsIpc = (registry: ToolRegistry): void => {
  ipcMain.handle('tools:list', () => registry.list())

  ipcMain.handle('tools:execute', async (_event, name: unknown, input: unknown) => {
    if (typeof name !== 'string' || !name || name.length > MAX_TOOL_NAME_LENGTH) {
      throw new Error('工具名称不正确')
    }

    let serialized: string
    try {
      serialized = JSON.stringify(input ?? null)
    } catch {
      throw new Error('工具参数格式不正确')
    }
    if (serialized.length > MAX_INPUT_CHARS) throw new Error('工具参数过大')

    return registry.execute(name, input, {
      source: 'ai',
      signal: new AbortController().signal
    })
  })
}
