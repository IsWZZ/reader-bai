// 主进程与扩展宿主之间的消息协议。
// 扩展宿主是独立 utilityProcess，只能通过这里的受限消息访问平台能力；
// 消息在校验后才进入主进程，未知方法、超长字段和错误结构一律丢弃。

export const PLUGIN_API_METHODS = ['tools.list', 'tools.execute'] as const
export type PluginApiMethod = (typeof PLUGIN_API_METHODS)[number]

export type PluginLogLevel = 'info' | 'warn' | 'error'
export type PluginRuntimeStatus = 'inactive' | 'activating' | 'active' | 'error'

export interface PluginRuntimeState {
  pluginId: string
  status: PluginRuntimeStatus
  /** 启动失败时的错误摘要 */
  message?: string
}

/** 平台交给扩展宿主的插件入口信息 */
export interface PluginHostDescriptor {
  id: string
  /** 插件入口的绝对路径 */
  entry: string
  permissions: string[]
  activationEvents: string[]
}

export interface PluginHostLog {
  pluginId: string
  level: PluginLogLevel
  message: string
}

export type HostToPlatformMessage =
  | { type: 'ready' }
  | {
      type: 'status'
      pluginId: string
      status: PluginRuntimeStatus
      message?: string
    }
  | ({ type: 'log' } & PluginHostLog)
  | {
      type: 'api-request'
      requestId: string
      pluginId: string
      method: PluginApiMethod
      params?: unknown
    }
  | { type: 'stopped' }

export type PlatformToHostMessage =
  | { type: 'start'; plugins: PluginHostDescriptor[] }
  | {
      type: 'api-response'
      requestId: string
      ok: boolean
      result?: unknown
      error?: string
    }
  | { type: 'stop' }

const MAX_ID_LENGTH = 100
const MAX_REQUEST_ID_LENGTH = 100
const MAX_LOG_LENGTH = 4000
const MAX_ERROR_LENGTH = 1000
const MAX_PARAMS_CHARS = 100_000

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

const readOptionalString = (
  value: unknown,
  label: string,
  maxLength: number
): string | undefined => {
  if (value === undefined || value === null) return undefined
  return readString(value, label, maxLength)
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

const isPluginApiMethod = (value: unknown): value is PluginApiMethod =>
  typeof value === 'string' && (PLUGIN_API_METHODS as readonly string[]).includes(value)

/** 校验扩展宿主发来的消息；不认识的类型直接拒绝 */
export const parseHostMessage = (value: unknown): HostToPlatformMessage => {
  const record = asRecord(value, '插件宿主消息')
  switch (record.type) {
    case 'ready':
      return { type: 'ready' }
    case 'stopped':
      return { type: 'stopped' }
    case 'status': {
      const status = record.status
      if (
        status !== 'inactive' &&
        status !== 'activating' &&
        status !== 'active' &&
        status !== 'error'
      ) {
        throw new Error('插件状态不正确')
      }
      return {
        type: 'status',
        pluginId: readString(record.pluginId, '插件 id', MAX_ID_LENGTH),
        status,
        message: readOptionalString(record.message, '状态说明', MAX_ERROR_LENGTH)
      }
    }
    case 'log': {
      const level = record.level
      if (level !== 'info' && level !== 'warn' && level !== 'error') {
        throw new Error('插件日志级别不正确')
      }
      return {
        type: 'log',
        pluginId: readString(record.pluginId, '插件 id', MAX_ID_LENGTH),
        level,
        message: readString(record.message, '日志内容', MAX_LOG_LENGTH)
      }
    }
    case 'api-request': {
      const method = record.method
      if (!isPluginApiMethod(method)) throw new Error('不支持的插件 API')
      if (record.params !== undefined) {
        assertSerializable(record.params, '插件 API 参数', MAX_PARAMS_CHARS)
      }
      return {
        type: 'api-request',
        requestId: readString(record.requestId, '请求 id', MAX_REQUEST_ID_LENGTH),
        pluginId: readString(record.pluginId, '插件 id', MAX_ID_LENGTH),
        method,
        params: record.params
      }
    }
    default:
      throw new Error('未知的插件宿主消息')
  }
}
