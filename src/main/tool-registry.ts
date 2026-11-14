// 平台工具注册表。
// 平台命令、内置模块和插件贡献的工具都从这里暴露给 agent；
// agent loop 不在平台里，但每一次工具调用都要经过这里的 schema 校验和权限钩子。

import type { ChatToolDefinition } from './ai'

export type ToolRisk = 'read' | 'write' | 'destructive'
export type ToolSource = 'ai' | 'plugin' | 'ui'

export interface ToolContext {
  source: ToolSource
  signal: AbortSignal
  pluginId?: string
  runId?: string
}

export interface ToolResult {
  content: string
  isError?: boolean
}

export interface ToolDefinition<I = unknown> {
  /** 稳定 id，建议使用 <domain>.<action>，插件工具带自己的命名空间 */
  name: string
  title: string
  /** 模型靠这段决定是否调用，必须写清楚副作用 */
  description: string
  /** JSON Schema，既用于模型工具定义，也用于展示 */
  inputSchema: Record<string, unknown>
  risk: ToolRisk
  /** 默认 false；显式打开后才会进入模型的工具列表 */
  exposeToAi?: boolean
  /** 返回校验后的输入；缺失时按原样传入 */
  validate?: (input: unknown) => I
  execute: (input: I, context: ToolContext) => Promise<ToolResult>
}

export interface ToolInfo {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  risk: ToolRisk
  exposeToAi: boolean
}

export interface ToolInvocation {
  tool: ToolInfo
  context: ToolContext
  input: unknown
}

export interface ToolRegistryOptions {
  /** 权限/确认钩子；返回 false 时拒绝执行 */
  authorize?: (invocation: ToolInvocation) => boolean | Promise<boolean>
  /** 审计钩子；异常不会影响工具结果 */
  onInvoke?: (invocation: ToolInvocation, result?: ToolResult, error?: unknown) => void
}

export interface ToolRegistry {
  register: <I>(definition: ToolDefinition<I>) => void
  list: (options?: { forAi?: boolean }) => ToolInfo[]
  get: (name: string) => ToolInfo | undefined
  execute: (name: string, input: unknown, context: ToolContext) => Promise<ToolResult>
}

interface RegisteredTool {
  info: ToolInfo
  validate?: (input: unknown) => unknown
  execute: (input: unknown, context: ToolContext) => Promise<ToolResult>
}

const toInfo = (definition: ToolDefinition<unknown>): ToolInfo => ({
  name: definition.name,
  title: definition.title,
  description: definition.description,
  inputSchema: definition.inputSchema,
  risk: definition.risk,
  exposeToAi: definition.exposeToAi === true
})

/** 把注册表里的工具转成 OpenAI 兼容的 tools 数组 */
export const toChatToolDefinition = (info: ToolInfo): ChatToolDefinition => ({
  type: 'function',
  function: {
    name: info.name,
    description: info.description,
    parameters: info.inputSchema
  }
})

export const createToolRegistry = (options: ToolRegistryOptions = {}): ToolRegistry => {
  const tools = new Map<string, RegisteredTool>()

  const register = <I>(definition: ToolDefinition<I>): void => {
    const name = definition.name.trim()
    if (!name) throw new Error('工具名称不能为空')
    if (tools.has(name)) throw new Error(`工具已注册：${name}`)

    tools.set(name, {
      info: { ...toInfo(definition as ToolDefinition<unknown>), name },
      validate: definition.validate,
      execute: (input, context) => definition.execute(input as I, context)
    })
  }

  const get = (name: string): ToolInfo | undefined => tools.get(name)?.info

  const list = ({ forAi = false }: { forAi?: boolean } = {}): ToolInfo[] =>
    [...tools.values()].map((tool) => tool.info).filter((info) => !forAi || info.exposeToAi)

  const execute = async (
    name: string,
    input: unknown,
    context: ToolContext
  ): Promise<ToolResult> => {
    const tool = tools.get(name)
    if (!tool) throw new Error(`工具不存在：${name}`)
    if (context.source === 'ai' && !tool.info.exposeToAi) {
      throw new Error(`工具未对 AI 开放：${name}`)
    }

    let invocation: ToolInvocation = { tool: tool.info, context, input }
    const notify = (result?: ToolResult, error?: unknown): void => {
      try {
        options.onInvoke?.(invocation, result, error)
      } catch {
        // 审计失败不能改变业务结果
      }
    }

    try {
      // 先校验再授权，确认弹窗里展示的应是校验后的参数
      const parsed = tool.validate ? tool.validate(input) : input
      invocation = { tool: tool.info, context, input: parsed }

      if (options.authorize && !(await options.authorize(invocation))) {
        throw new Error(`没有权限执行该工具：${name}`)
      }

      const result = await tool.execute(parsed, context)
      notify(result)
      return result
    } catch (error) {
      notify(undefined, error)
      throw error
    }
  }

  return { register, list, get, execute }
}
