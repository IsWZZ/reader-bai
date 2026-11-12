import { ipcMain } from 'electron'
import { normalizeChatMessages, streamChatCompletion } from '../ai'
import type { SettingsStore } from '../settings-store'

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** AI 对话的 IPC：Key 只在主进程解密，不经过渲染进程参数 */
export const registerAiIpc = (settings: SettingsStore): void => {
  // 进行中的 AI 请求，按 requestId 索引，供渲染进程中止
  const aiRequests = new Map<string, AbortController>()

  // 流式对话：增量通过 ai:chunk 事件推送，invoke 在结束时返回完整文本
  ipcMain.handle(
    'ai:chat',
    async (event, requestId: unknown, messages: unknown, profileId: unknown) => {
      if (typeof requestId !== 'string' || !requestId || requestId.length > 100) {
        throw new Error('请求标识不正确')
      }
      if (typeof profileId !== 'string' || !profileId || profileId.length > 100) {
        throw new Error('请先在设置中选择 AI 服务')
      }
      const normalized = normalizeChatMessages(messages)

      const stored = await settings.read()
      const profile = stored.ai.profiles.find((item) => item.id === profileId)
      if (!profile) throw new Error('所选 AI 配置不存在，请重新选择')

      const apiKey = settings.decodeApiKey(profile)
      if (!profile.baseUrl || !profile.model) {
        throw new Error('请先补全所选 AI 服务的 Base URL、API Key 和模型')
      }
      if (!apiKey) {
        if (profile.apiKeyEncrypted) throw new Error('API Key 解密失败，请重新填写')
        throw new Error('请先补全所选 AI 服务的 Base URL、API Key 和模型')
      }
      if (!isHttpUrl(profile.baseUrl)) {
        throw new Error('Base URL 需要是以 http:// 或 https:// 开头的地址')
      }

      const controller = new AbortController()
      const abort = (): void => controller.abort()
      aiRequests.set(requestId, controller)
      event.sender.once('destroyed', abort)

      try {
        return await streamChatCompletion({
          baseUrl: profile.baseUrl,
          apiKey,
          model: profile.model,
          messages: normalized,
          signal: controller.signal,
          onDelta: (delta) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('ai:chunk', { requestId, delta })
            }
          }
        })
      } finally {
        event.sender.removeListener('destroyed', abort)
        aiRequests.delete(requestId)
      }
    }
  )

  // 中止指定请求；中止后 ai:chat 会把已收到的内容作为结果返回
  ipcMain.on('ai:abort', (_event, requestId: unknown) => {
    if (typeof requestId === 'string') {
      aiRequests.get(requestId)?.abort()
    }
  })
}
