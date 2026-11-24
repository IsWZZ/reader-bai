// 主进程与翻译宿主之间的消息协议。
// 翻译宿主是独立 utilityProcess：它只构造翻译消息并请求平台调用模型，
// 拿不到 API Key、设置、文件系统或窗口。两端都重新校验每条消息。

export const MAX_REQUEST_ID_LENGTH = 100
export const MAX_PROFILE_ID_LENGTH = 100
export const MAX_SOURCE_CHARS = 8000
export const MAX_TEXT_CHARS = 100_000
export const MAX_MESSAGES_CHARS = 200_000
export const MAX_ERROR_LENGTH = 2000

export interface TranslateRequest {
  requestId: string
  source: string
  profileId: string
}

export type PlatformToHostMessage =
  | { type: 'translate'; requestId: string; source: string }
  | { type: 'response'; requestId: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'cancel'; requestId: string }
  | { type: 'stop' }

export type HostToPlatformMessage =
  | { type: 'ready' }
  | { type: 'stopped' }
  | { type: 'chat-request'; requestId: string; messages: unknown }
  | { type: 'done'; requestId: string; text: string }
  | { type: 'error'; requestId: string; message: string }

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`)
  }
  return value as Record<string, unknown>
}

const readString = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}必须是非空字符串`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new Error(`${label}过长`)
  return trimmed
}

const readText = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${label}不正确`)
  return value
}

const assertSerializable = (value: unknown, label: string, maxChars: number): void => {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new Error(`${label}无法序列化`, { cause: error })
  }
  if (serialized === undefined) throw new Error(`${label}无法序列化`)
  if (serialized.length > maxChars) throw new Error(`${label}过大`)
}

/** 校验渲染进程提交的翻译请求；source 和 profileId 都不可信。 */
export const parseTranslateRequest = (value: unknown): TranslateRequest => {
  const record = asRecord(value, '翻译请求')
  return {
    requestId: readString(record.requestId, '请求标识', MAX_REQUEST_ID_LENGTH),
    source: readString(record.source, '待翻译文本', MAX_SOURCE_CHARS),
    profileId: readString(record.profileId, 'AI 配置', MAX_PROFILE_ID_LENGTH)
  }
}

/** 校验翻译宿主发来的消息；不认识的类型直接拒绝。 */
export const parseHostMessage = (value: unknown): HostToPlatformMessage => {
  const record = asRecord(value, '翻译宿主消息')
  switch (record.type) {
    case 'ready':
      return { type: 'ready' }
    case 'stopped':
      return { type: 'stopped' }
    case 'chat-request': {
      assertSerializable(record.messages, '对话消息', MAX_MESSAGES_CHARS)
      return {
        type: 'chat-request',
        requestId: readString(record.requestId, '请求标识', MAX_REQUEST_ID_LENGTH),
        messages: record.messages
      }
    }
    case 'done':
      return {
        type: 'done',
        requestId: readString(record.requestId, '请求标识', MAX_REQUEST_ID_LENGTH),
        text: readText(record.text, '翻译结果', MAX_TEXT_CHARS)
      }
    case 'error':
      return {
        type: 'error',
        requestId: readString(record.requestId, '请求标识', MAX_REQUEST_ID_LENGTH),
        message: readString(record.message, '错误信息', MAX_ERROR_LENGTH)
      }
    default:
      throw new Error('未知的翻译宿主消息')
  }
}

/** 宿主侧校验平台发来的消息；主进程是受信任的，仍做一次防御性检查。 */
export const parsePlatformMessage = (value: unknown): PlatformToHostMessage => {
  const record = asRecord(value, '平台消息')
  switch (record.type) {
    case 'translate':
      return {
        type: 'translate',
        requestId: readString(record.requestId, '请求标识', MAX_REQUEST_ID_LENGTH),
        source: readString(record.source, '待翻译文本', MAX_SOURCE_CHARS)
      }
    case 'response': {
      if (typeof record.ok !== 'boolean') throw new Error('响应状态不正确')
      if (record.ok) {
        if (record.result !== undefined) {
          assertSerializable(record.result, '响应结果', MAX_MESSAGES_CHARS)
        }
        return {
          type: 'response',
          requestId: readString(record.requestId, '请求标识', MAX_REQUEST_ID_LENGTH),
          ok: true,
          result: record.result
        }
      }
      return {
        type: 'response',
        requestId: readString(record.requestId, '请求标识', MAX_REQUEST_ID_LENGTH),
        ok: false,
        error:
          record.error === undefined
            ? '平台请求失败'
            : readString(record.error, '错误信息', MAX_ERROR_LENGTH)
      }
    }
    case 'cancel':
      return {
        type: 'cancel',
        requestId: readString(record.requestId, '请求标识', MAX_REQUEST_ID_LENGTH)
      }
    case 'stop':
      return { type: 'stop' }
    default:
      throw new Error('未知的平台消息')
  }
}
