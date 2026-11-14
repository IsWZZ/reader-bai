// 扩展宿主的主进程侧：发现变更后启动/停止 utilityProcess，
// 校验宿主消息，并把插件发起的工具请求送回平台注册表。
// 插件代码始终在独立进程里运行；主进程只按 manifest 权限放行工具调用。

import { utilityProcess, type UtilityProcess } from 'electron'
import type { ToolRegistry } from '../tool-registry'
import { missingToolPermissions } from './api'
import {
  parseHostMessage,
  type HostToPlatformMessage,
  type PluginHostDescriptor,
  type PluginHostLog,
  type PluginRuntimeState
} from './protocol'

const MAX_TOOL_NAME_LENGTH = 100
const MAX_INPUT_CHARS = 100_000
const MAX_ERROR_LENGTH = 1000
const MAX_PENDING_REQUESTS = 50
const STOP_TIMEOUT_MS = 3000

export interface PluginRuntime {
  /** 按当前启用状态重新加载扩展宿主；没有变化时保持现有进程 */
  refresh: () => Promise<void>
  snapshot: () => PluginRuntimeState[]
  stop: () => Promise<void>
}

export interface PluginRuntimeOptions {
  /** 构建产物中扩展宿主入口的绝对路径 */
  hostScript: string
  tools: ToolRegistry
  /** 读取当前启用且可运行的插件 */
  getPlugins: () => Promise<PluginHostDescriptor[]>
  onChange?: (states: PluginRuntimeState[]) => void
  onLog?: (entry: PluginHostLog) => void
}

const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('插件 API 参数必须是对象')
  }
  return value as Record<string, unknown>
}

export const createPluginRuntime = (options: PluginRuntimeOptions): PluginRuntime => {
  let child: UtilityProcess | null = null
  let descriptors: PluginHostDescriptor[] = []
  let states = new Map<string, PluginRuntimeState>()
  let signature = ''
  let queue: Promise<void> = Promise.resolve()
  const requests = new Map<string, AbortController>()

  const snapshot = (): PluginRuntimeState[] =>
    descriptors.map(
      (descriptor) => states.get(descriptor.id) ?? { pluginId: descriptor.id, status: 'inactive' }
    )

  const notify = (): void => options.onChange?.(snapshot())

  const log = (entry: PluginHostLog): void => options.onLog?.(entry)

  const setState = (
    pluginId: string,
    status: PluginRuntimeState['status'],
    message?: string
  ): void => {
    if (!descriptors.some((descriptor) => descriptor.id === pluginId)) return
    states.set(pluginId, { pluginId, status, message })
    notify()
  }

  const abortRequests = (): void => {
    for (const controller of requests.values()) controller.abort()
    requests.clear()
  }

  const postToHost = (message: unknown): void => {
    if (!child) return
    try {
      child.postMessage(message)
    } catch {
      // 宿主已退出时由 exit 事件统一处理
    }
  }

  const respond = (
    requestId: string,
    payload: { ok: true; result: unknown } | { ok: false; error: string }
  ): void => {
    postToHost({ type: 'api-response', requestId, ...payload })
  }

  const executePluginTool = async (
    descriptor: PluginHostDescriptor,
    params: unknown,
    signal: AbortSignal
  ): ReturnType<ToolRegistry['execute']> => {
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

    const missing = missingToolPermissions(tool, descriptor.permissions)
    if (missing.length > 0) throw new Error(`插件缺少权限：${missing.join(', ')}`)

    return options.tools.execute(name.trim(), record.input, {
      source: 'plugin',
      pluginId: descriptor.id,
      signal
    })
  }

  const handleApiRequest = async (
    message: Extract<HostToPlatformMessage, { type: 'api-request' }>
  ): Promise<void> => {
    const descriptor = descriptors.find((item) => item.id === message.pluginId)
    if (!descriptor) {
      respond(message.requestId, { ok: false, error: '插件未启用' })
      return
    }
    if (requests.size >= MAX_PENDING_REQUESTS) {
      respond(message.requestId, { ok: false, error: '待处理的请求过多' })
      return
    }

    const controller = new AbortController()
    requests.set(message.requestId, controller)
    try {
      const result =
        message.method === 'tools.list'
          ? options.tools.list({ forAi: true })
          : await executePluginTool(descriptor, message.params, controller.signal)
      respond(message.requestId, { ok: true, result })
    } catch (error) {
      respond(message.requestId, { ok: false, error: describeError(error) })
    } finally {
      requests.delete(message.requestId)
    }
  }

  const handleMessage = (value: unknown): void => {
    let message: HostToPlatformMessage
    try {
      message = parseHostMessage(value)
    } catch (error) {
      log({ pluginId: 'platform', level: 'warn', message: describeError(error) })
      return
    }

    if (message.type === 'status') {
      setState(message.pluginId, message.status, message.message)
    } else if (message.type === 'log') {
      log({ pluginId: message.pluginId, level: message.level, message: message.message })
    } else if (message.type === 'api-request') {
      void handleApiRequest(message)
    }
  }

  const startHost = (): void => {
    let proc: UtilityProcess
    try {
      proc = utilityProcess.fork(options.hostScript, [], { serviceName: 'reader-bai plugins' })
    } catch (error) {
      const message = `无法启动扩展宿主：${describeError(error)}`
      for (const descriptor of descriptors) {
        states.set(descriptor.id, { pluginId: descriptor.id, status: 'error', message })
      }
      notify()
      return
    }

    child = proc
    proc.on('message', (message) => {
      if (child !== proc) return
      handleMessage(message)
    })
    proc.once('spawn', () => {
      if (child !== proc) return
      postToHost({ type: 'start', plugins: descriptors })
    })
    proc.once('exit', (code) => {
      if (child !== proc) return
      child = null
      abortRequests()
      for (const descriptor of descriptors) {
        const current = states.get(descriptor.id)
        if (current?.status === 'error') continue
        states.set(descriptor.id, {
          pluginId: descriptor.id,
          status: 'error',
          message: `扩展宿主已退出（${code}）`
        })
      }
      notify()
    })
  }

  const stopHost = (): Promise<void> => {
    const proc = child
    child = null
    abortRequests()
    descriptors = []
    states = new Map()
    signature = ''
    notify()

    if (!proc) return Promise.resolve()

    return new Promise((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // 进程可能已经退出
        }
        done()
      }, STOP_TIMEOUT_MS)

      proc.once('exit', done)
      try {
        proc.postMessage({ type: 'stop' })
      } catch {
        try {
          proc.kill()
        } catch {
          // 进程可能已经退出
        }
        done()
      }
    })
  }

  const refresh = (): Promise<void> => {
    const run = async (): Promise<void> => {
      const next = await options.getPlugins()
      const nextSignature = JSON.stringify(next)
      if (child && nextSignature === signature) return

      await stopHost()
      signature = nextSignature
      descriptors = next
      states = new Map(
        next.map((descriptor) => [descriptor.id, { pluginId: descriptor.id, status: 'inactive' }])
      )
      notify()
      if (next.length > 0) startHost()
    }

    queue = queue.then(run, run)
    return queue
  }

  const stop = (): Promise<void> => {
    queue = queue.then(stopHost, stopHost)
    return queue
  }

  return { refresh, snapshot, stop }
}
