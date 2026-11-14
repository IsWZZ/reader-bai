// 扩展宿主入口：由主进程用 utilityProcess 启动的独立进程。
// 这里加载已启用插件的 main，向插件提供受限的 context，并通过 parentPort
// 把工具调用转给主进程；插件代码不直接接触 BrowserWindow、设置或 API Key。

import { randomUUID } from 'crypto'
import { isAbsolute } from 'path'
import { pathToFileURL } from 'url'
import { PLUGIN_PERMISSIONS, STARTUP_ACTIVATION, type PluginPermission } from './manifest'
import type { PluginHostDescriptor, PlatformToHostMessage, PluginLogLevel } from './protocol'
import type { PluginContext, PluginModule } from './api'

interface ParentPortLike {
  on: (event: 'message', listener: (event: { data: unknown }) => void) => void
  postMessage: (message: unknown) => void
}

type MessageSink = (message: unknown) => void

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort

const ACTIVATE_TIMEOUT_MS = 10_000
const PLATFORM_TIMEOUT_MS = 10 * 60_000
const MAX_PENDING_REQUESTS = 50
const MAX_ID_LENGTH = 100
const MAX_ENTRY_LENGTH = 4096
const MAX_PERMISSIONS = 20
const MAX_ACTIVATION_EVENTS = 50
const MAX_LOG_LENGTH = 4000
const MAX_ERROR_LENGTH = 1000
const MAX_PLUGINS = 100
const KEEP_ALIVE_MS = 60_000

const send: MessageSink = (message) => {
  try {
    parentPort?.postMessage(message)
  } catch {
    // 宿主正在退出时发送失败可以忽略
  }
}

const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message
}

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

const readStringArray = (
  value: unknown,
  label: string,
  maxItems: number,
  maxLength: number
): string[] => {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  if (value.length > maxItems) throw new Error(`${label}数量超过允许值`)
  return value.map((item) => readString(item, label, maxLength))
}

/** 主进程是受信任的，但入口信息仍按不可信输入校验一次 */
const parseDescriptors = (value: unknown): PluginHostDescriptor[] => {
  if (!Array.isArray(value)) throw new Error('插件列表格式不正确')
  if (value.length > MAX_PLUGINS) throw new Error('插件数量超过允许值')

  const seen = new Set<string>()
  return value.map((item, index) => {
    const record = asRecord(item, `插件列表[${index}]`)
    const id = readString(record.id, '插件 id', MAX_ID_LENGTH)
    if (seen.has(id)) throw new Error(`插件 id 重复：${id}`)
    seen.add(id)

    const entry = readString(record.entry, '插件入口', MAX_ENTRY_LENGTH)
    if (!isAbsolute(entry) || entry.includes('\0')) throw new Error('插件入口必须是绝对路径')

    return {
      id,
      entry,
      permissions: readStringArray(record.permissions, '插件权限', MAX_PERMISSIONS, MAX_ID_LENGTH),
      activationEvents: readStringArray(
        record.activationEvents,
        '插件激活事件',
        MAX_ACTIVATION_EVENTS,
        MAX_ID_LENGTH
      )
    }
  })
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingRequest>()
const loaded = new Map<string, { module: PluginModule; context: PluginContext }>()

const withTimeout = async <T>(task: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const callPlatform = <T>(
  pluginId: string,
  method: 'tools.list' | 'tools.execute',
  params?: unknown
): Promise<T> => {
  if (!parentPort) return Promise.reject(new Error('扩展宿主未连接到平台'))
  if (pending.size >= MAX_PENDING_REQUESTS) {
    return Promise.reject(new Error('待处理的平台请求过多'))
  }

  return new Promise<T>((resolve, reject) => {
    const requestId = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('平台请求超时'))
    }, PLATFORM_TIMEOUT_MS)
    pending.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      timer
    })
    send({ type: 'api-request', requestId, pluginId, method, params })
  })
}

const settleRequest = (message: Extract<PlatformToHostMessage, { type: 'api-response' }>): void => {
  const request = pending.get(message.requestId)
  if (!request) return
  pending.delete(message.requestId)
  clearTimeout(request.timer)
  if (message.ok) {
    request.resolve(message.result)
  } else {
    request.reject(new Error(message.error ?? '平台请求失败'))
  }
}

const grantedPermissions = (permissions: string[]): PluginPermission[] =>
  permissions.filter((permission): permission is PluginPermission =>
    (PLUGIN_PERMISSIONS as readonly string[]).includes(permission)
  )

const createContext = (descriptor: PluginHostDescriptor): PluginContext => ({
  pluginId: descriptor.id,
  permissions: grantedPermissions(descriptor.permissions),
  log: (level, message) => {
    const safeLevel: PluginLogLevel = level === 'warn' || level === 'error' ? level : 'info'
    send({
      type: 'log',
      pluginId: descriptor.id,
      level: safeLevel,
      message: String(message).slice(0, MAX_LOG_LENGTH)
    })
  },
  tools: {
    list: () => callPlatform(descriptor.id, 'tools.list'),
    execute: (name, input) => {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_ID_LENGTH) {
        return Promise.reject(new Error('工具名称不正确'))
      }
      return callPlatform(descriptor.id, 'tools.execute', {
        name: name.trim(),
        input: input ?? null
      })
    }
  }
})

const status = (
  descriptor: PluginHostDescriptor,
  value: 'activating' | 'active' | 'error' | 'inactive',
  message?: string
): void => {
  send({ type: 'status', pluginId: descriptor.id, status: value, message })
}

const activatePlugin = async (descriptor: PluginHostDescriptor): Promise<void> => {
  if (!descriptor.activationEvents.includes(STARTUP_ACTIVATION)) {
    status(descriptor, 'inactive', '等待命令触发')
    return
  }

  status(descriptor, 'activating')
  try {
    const loadedModule = await withTimeout(
      import(pathToFileURL(descriptor.entry).href),
      ACTIVATE_TIMEOUT_MS,
      '加载插件超时'
    )
    const entryModule = loadedModule as PluginModule & { default?: PluginModule }
    const activate = entryModule.activate ?? entryModule.default?.activate
    if (typeof activate !== 'function') throw new Error('插件入口没有导出 activate')

    const context = createContext(descriptor)
    await withTimeout(
      Promise.resolve(activate.call(entryModule, context)),
      ACTIVATE_TIMEOUT_MS,
      '激活插件超时'
    )
    loaded.set(descriptor.id, {
      module: {
        activate,
        deactivate: entryModule.deactivate ?? entryModule.default?.deactivate
      },
      context
    })
    status(descriptor, 'active')
  } catch (error) {
    status(descriptor, 'error', describeError(error))
  }
}

let started = false

const start = (value: unknown): void => {
  if (started) return
  started = true
  send({ type: 'ready' })

  let descriptors: PluginHostDescriptor[]
  try {
    descriptors = parseDescriptors(value)
  } catch (error) {
    // 没有可用插件时不激活任何代码，但保留宿主进程以接收 stop
    send({ type: 'log', pluginId: 'platform', level: 'error', message: describeError(error) })
    return
  }

  for (const descriptor of descriptors) {
    void activatePlugin(descriptor)
  }
}

const shutdown = async (): Promise<void> => {
  for (const { module } of loaded.values()) {
    try {
      await withTimeout(Promise.resolve(module.deactivate?.()), ACTIVATE_TIMEOUT_MS, '停用插件超时')
    } catch {
      // 停用失败不阻塞退出
    }
  }
  loaded.clear()
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(new Error('扩展宿主已停止'))
  }
  pending.clear()
  send({ type: 'stopped' })
  setImmediate(() => process.exit(0))
}

const handleMessage = (value: unknown): void => {
  if (!value || typeof value !== 'object') return
  const message = value as PlatformToHostMessage
  if (message.type === 'start') {
    start(message.plugins)
  } else if (message.type === 'api-response') {
    settleRequest(message)
  } else if (message.type === 'stop') {
    void shutdown()
  }
}

// 保持进程存活，等待平台请求；退出由 stop 消息或父进程结束触发
setInterval(() => undefined, KEEP_ALIVE_MS)

if (parentPort) {
  parentPort.on('message', (event) => handleMessage(event.data))
}
