// 插件 UI 的能力边界。
// iframe 只能通过受限 RPC 调用这里的 tools.list / tools.execute；
// 权限来自已启用插件的 manifest，写操作仍由平台工具执行边界确认。

import type { ToolRegistry } from '../tool-registry'
import { missingToolPermissions } from './api'
import type { PluginHost } from './host'

const MAX_ID_LENGTH = 200
const MAX_TOOL_NAME_LENGTH = 100
const MAX_INPUT_CHARS = 100_000
const MAX_ERROR_LENGTH = 1000

export type PluginViewMethod = 'tools.list' | 'tools.execute'

export interface PluginViewBridge {
  request: (pluginId: string, viewId: string, method: string, params: unknown) => Promise<unknown>
}

export interface PluginViewBridgeOptions {
  host: Pick<PluginHost, 'resolveView'>
  tools: ToolRegistry
}

const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message
}

const readId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_ID_LENGTH) {
    throw new Error(`${label}不正确`)
  }
  return value.trim()
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('插件请求参数必须是对象')
  }
  return value as Record<string, unknown>
}

export const createPluginViewBridge = (options: PluginViewBridgeOptions): PluginViewBridge => {
  const executeTool = async (
    pluginId: string,
    permissions: readonly string[],
    params: unknown
  ): Promise<unknown> => {
    const record = asRecord(params)
    const name = record.name
    if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_TOOL_NAME_LENGTH) {
      throw new Error('工具名称不正确')
    }

    let serialized: string
    try {
      serialized = JSON.stringify(record.input ?? null)
    } catch {
      throw new Error('工具参数格式不正确')
    }
    if (serialized.length > MAX_INPUT_CHARS) throw new Error('工具参数过大')

    const tool = options.tools.get(name.trim())
    if (!tool) throw new Error(`工具不存在：${name.trim()}`)

    const missing = missingToolPermissions(tool, permissions)
    if (missing.length > 0) throw new Error(`插件缺少权限：${missing.join(', ')}`)

    return options.tools.execute(name.trim(), record.input, {
      source: 'plugin',
      pluginId,
      signal: new AbortController().signal
    })
  }

  const runRequest = async (
    pluginId: string,
    viewId: string,
    method: string,
    params: unknown
  ): Promise<unknown> => {
    const safePluginId = readId(pluginId, '插件 id')
    const safeViewId = readId(viewId, '视图 id')
    const resolved = await options.host.resolveView(safePluginId, safeViewId)
    if (!resolved) throw new Error('插件视图不存在或未启用')

    if (method === 'tools.list') return options.tools.list({ forAi: true })
    if (method === 'tools.execute') {
      return executeTool(safePluginId, resolved.permissions, params)
    }
    throw new Error('不支持的插件视图请求')
  }

  return {
    request: async (pluginId, viewId, method, params) => {
      try {
        return await runRequest(pluginId, viewId, method, params)
      } catch (error) {
        throw new Error(describeError(error), { cause: error })
      }
    }
  }
}
