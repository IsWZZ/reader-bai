import { BrowserWindow, dialog } from 'electron'
import type { ToolInvocation } from '../tool-registry'

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
  const requester = `插件 ${invocation.context.pluginId ?? '未知'}`
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
