// 单次 AI 请求的执行边界，供 IPC（翻译）和 agent 宿主复用。
// Key 只在这里解密；渲染进程和 agent 宿主都拿不到明文。
// 这里刻意不依赖 electron，方便直接做单元测试。

import {
  normalizeChatMessages,
  streamChat,
  type ChatToolDefinition,
  type StreamChatResult
} from './ai'
import { streamAnthropic } from './ai-anthropic'
import type { AgentRun } from './ai-run'
import { AI_BASE_URL_ERROR, isAllowedAiBaseUrl } from './settings'
import type { SettingsStore } from './settings-store'
import { toChatToolDefinition, type ToolRegistry } from './tool-registry'

const MAX_TOOLS = 50
const MAX_TOOL_NAME_LENGTH = 100
const MAX_REQUEST_ID_LENGTH = 100
const MAX_PROFILE_ID_LENGTH = 100

/** 只接受平台注册表里的工具名，schema 由主进程决定，调用方不能伪造 */
export const resolveChatTools = (input: unknown, registry: ToolRegistry): ChatToolDefinition[] => {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new Error('工具列表不正确')
  if (input.length > MAX_TOOLS) throw new Error(`工具数量不能超过 ${MAX_TOOLS} 个`)

  const names = new Set<string>()
  for (const item of input) {
    if (typeof item !== 'string' || !item.trim() || item.length > MAX_TOOL_NAME_LENGTH) {
      throw new Error('工具名称不正确')
    }
    names.add(item.trim())
  }

  return [...names].map((name) => {
    const info = registry.get(name)
    if (!info || !info.exposeToAi) throw new Error(`工具不存在或未对 AI 开放：${name}`)
    return toChatToolDefinition(info)
  })
}

export interface AiChatRequest {
  requestId: string
  messages: unknown
  profileId: string
  /** 只用于解析工具 schema，真正的执行仍在调用方 */
  toolNames?: string[]
  /** 平台 run：计步、预算和取消都绑定在这里 */
  run?: AgentRun
  /** 调用方自己的取消源（如 agent 宿主会话） */
  signal?: AbortSignal
  onDelta: (delta: string) => void
}

export interface AiRequester {
  chat: (request: AiChatRequest) => Promise<StreamChatResult>
  abort: (requestId: string) => void
}

export const createAiRequester = (settings: SettingsStore, tools: ToolRegistry): AiRequester => {
  // 进行中的请求，按 requestId 索引，供外部中止
  const requests = new Map<string, AbortController>()

  const chat = async (request: AiChatRequest): Promise<StreamChatResult> => {
    if (
      typeof request.requestId !== 'string' ||
      !request.requestId ||
      request.requestId.length > MAX_REQUEST_ID_LENGTH
    ) {
      throw new Error('请求标识不正确')
    }
    if (
      typeof request.profileId !== 'string' ||
      !request.profileId ||
      request.profileId.length > MAX_PROFILE_ID_LENGTH
    ) {
      throw new Error('请先在设置中选择 AI 服务')
    }
    if (requests.has(request.requestId)) throw new Error('请求标识重复')

    const normalized = normalizeChatMessages(request.messages)
    const toolDefinitions = resolveChatTools(request.toolNames, tools)

    // 先占位再读取设置：读取期间同名请求会被拒绝，abort 也能提前生效
    const controller = new AbortController()
    let detach = (): void => undefined
    requests.set(request.requestId, controller)

    try {
      const stored = await settings.read()
      const profile = stored.ai.profiles.find((item) => item.id === request.profileId)
      if (!profile) throw new Error('所选 AI 配置不存在，请重新选择')
      // 禁用状态由主进程强制执行，不能靠渲染进程隐藏选项来绕过
      if (!profile.enabled) throw new Error('所选 AI 配置已禁用，请启用或选择其他配置')

      const apiKey = settings.decodeApiKey(profile)
      if (!profile.baseUrl || !profile.model) {
        throw new Error('请先补全所选 AI 服务的 Base URL、API Key 和模型')
      }
      if (!apiKey) {
        if (profile.apiKeyEncrypted) throw new Error('API Key 解密失败，请重新填写')
        throw new Error('请先补全所选 AI 服务的 Base URL、API Key 和模型')
      }
      if (!isAllowedAiBaseUrl(profile.baseUrl)) {
        throw new Error(AI_BASE_URL_ERROR)
      }

      // run 边界：每次模型调用计一步；超出预算或已被取消时不再发起请求
      if (request.run) {
        if (request.run.isAborted) throw new Error('运行已取消')
        request.run.recordStep()
      }

      const abort = (): void => controller.abort()
      request.run?.signal.addEventListener('abort', abort, { once: true })
      request.signal?.addEventListener('abort', abort, { once: true })
      detach = () => {
        request.run?.signal.removeEventListener('abort', abort)
        request.signal?.removeEventListener('abort', abort)
      }
      if (request.run?.signal.aborted || request.signal?.aborted) controller.abort()

      // 协议差异只在网关层处理，调用方（翻译和 agent 宿主）拿到的仍是同一结果结构
      const stream = profile.provider === 'anthropic' ? streamAnthropic : streamChat
      return await stream({
        baseUrl: profile.baseUrl,
        apiKey,
        model: profile.model,
        messages: normalized,
        signal: controller.signal,
        tools: toolDefinitions,
        onDelta: request.onDelta
      })
    } finally {
      detach()
      requests.delete(request.requestId)
    }
  }

  const abort = (requestId: string): void => {
    requests.get(requestId)?.abort()
  }

  return { chat, abort }
}
