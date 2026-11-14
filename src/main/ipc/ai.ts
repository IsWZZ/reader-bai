import { ipcMain } from 'electron'
import type { AiRequester } from '../ai-request'

const MAX_REQUEST_ID_LENGTH = 100
const MAX_PROFILE_ID_LENGTH = 100

/**
 * 单次流式对话（当前用于选区翻译）。
 * Key 只在主进程解密；增量通过 ai:chunk 推送，invoke 在结束时返回完整文本。
 * agent 循环不再经过这里，改由 agent 宿主向主进程发起请求。
 */
export const registerAiIpc = (requester: AiRequester): void => {
  ipcMain.handle(
    'ai:chat',
    async (event, requestId: unknown, messages: unknown, profileId: unknown) => {
      if (typeof requestId !== 'string' || !requestId || requestId.length > MAX_REQUEST_ID_LENGTH) {
        throw new Error('请求标识不正确')
      }
      if (typeof profileId !== 'string' || !profileId || profileId.length > MAX_PROFILE_ID_LENGTH) {
        throw new Error('请先在设置中选择 AI 服务')
      }

      const abort = (): void => requester.abort(requestId)
      event.sender.once('destroyed', abort)

      try {
        const result = await requester.chat({
          requestId,
          messages,
          profileId,
          onDelta: (delta) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('ai:chunk', { requestId, delta })
            }
          }
        })
        return result.text
      } finally {
        event.sender.removeListener('destroyed', abort)
      }
    }
  )

  // 中止指定请求；中止后 ai:chat 会把已收到的内容作为结果返回
  ipcMain.on('ai:abort', (_event, requestId: unknown) => {
    if (typeof requestId === 'string') requester.abort(requestId)
  })
}
