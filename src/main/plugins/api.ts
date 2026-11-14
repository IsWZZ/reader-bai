// 插件作者可见的运行时契约。
// 插件代码运行在扩展宿主进程里，只能通过 context 访问平台能力；
// manifest 权限决定哪些工具调用会被主进程放行，写操作仍由主进程弹窗确认。

import type { ToolInfo, ToolResult } from '../tool-registry'
import type { PluginLogLevel } from './protocol'
import type { PluginPermission } from './manifest'

export interface PluginToolsApi {
  /** 列出对插件开放的平台工具 */
  list: () => Promise<ToolInfo[]>
  /** 执行平台工具；缺少权限或用户取消时 reject */
  execute: (name: string, input: unknown) => Promise<ToolResult>
}

export interface PluginContext {
  pluginId: string
  /** manifest 中声明的权限；未声明的工具调用会被拒绝 */
  permissions: PluginPermission[]
  log: (level: PluginLogLevel, message: string) => void
  tools: PluginToolsApi
}

export interface PluginModule {
  /** 入口文件必须导出 activate；支持 CJS 和 ESM */
  activate: (context: PluginContext) => void | Promise<void>
  /** 关闭插件或退出应用时调用，可省略 */
  deactivate?: () => void | Promise<void>
}

/** 返回插件缺少的权限；空数组表示可以执行 */
export const missingToolPermissions = (
  tool: { requiredPermissions: readonly string[] },
  granted: readonly string[]
): string[] => tool.requiredPermissions.filter((permission) => !granted.includes(permission))
