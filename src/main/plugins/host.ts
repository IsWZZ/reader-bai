// 插件宿主的持久化状态与查询边界。
// 当前只负责发现和启用状态，不加载插件代码；第三方插件默认关闭，
// 用户显式启用且版本兼容后，后续的扩展宿主才会执行 manifest.main。

import { mkdir, readFile, realpath, stat, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'path'
import { discoverPlugins, type DiscoveredPlugin, type PluginDiscoveryIssue } from './discovery'
import {
  isEngineCompatible,
  isSafeRelativePath,
  type PluginCommandContribution,
  type PluginPermission,
  type PluginViewContribution
} from './manifest'
import type { PluginHostDescriptor } from './protocol'

const MAX_STATE_BYTES = 1024 * 1024
const MAX_VIEW_ASSET_BYTES = 20 * 1024 * 1024

export interface PluginStatus {
  id: string
  name: string
  version: string
  description?: string
  permissions: PluginPermission[]
  commands: PluginCommandContribution[]
  views: PluginViewContribution[]
  /** 用户已启用且与当前宿主版本兼容 */
  enabled: boolean
  compatible: boolean
}

export interface ResolvedPluginView {
  view: PluginViewContribution
  permissions: PluginPermission[]
}

export interface ResolvedPluginAsset {
  filePath: string
  permissions: PluginPermission[]
}

export interface PluginIssue {
  directoryName: string
  message: string
}

export interface PluginListResult {
  plugins: PluginStatus[]
  issues: PluginIssue[]
}

export interface PluginHost {
  list: () => Promise<PluginListResult>
  setEnabled: (id: string, enabled: boolean) => Promise<PluginStatus>
  /** 当前已启用、版本兼容且声明了入口的插件，供扩展宿主启动 */
  runtimePlugins: () => Promise<PluginHostDescriptor[]>
  /** 解析已启用插件的视图，供 UI 请求工具时校验权限 */
  resolveView: (pluginId: string, viewId: string) => Promise<ResolvedPluginView | null>
  /** 解析插件目录内的静态资源；只对已启用且兼容的插件放行 */
  resolveAsset: (pluginId: string, assetPath: string) => Promise<ResolvedPluginAsset | null>
}

export interface PluginHostOptions {
  /** 插件目录，通常是 userData/Userdata/plugins */
  root: string
  /** 启用状态文件，通常是 userData/Userdata/plugins.json */
  stateFile: string
  /** 宿主版本，用于判断 engines.readerBai */
  appVersion: string
}

interface PluginStateFile {
  enabled: Record<string, boolean>
}

const emptyState = (): PluginStateFile => ({ enabled: {} })

const parseState = (value: unknown): PluginStateFile => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyState()
  const raw = (value as Record<string, unknown>).enabled
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyState()

  const enabled: Record<string, boolean> = {}
  for (const [id, flag] of Object.entries(raw)) {
    if (flag === true) enabled[id] = true
  }
  return { enabled }
}

const readState = async (stateFile: string): Promise<PluginStateFile> => {
  let raw: string
  try {
    raw = await readFile(stateFile, 'utf8')
  } catch {
    return emptyState()
  }
  if (raw.length > MAX_STATE_BYTES) return emptyState()
  try {
    return parseState(JSON.parse(raw))
  } catch {
    return emptyState()
  }
}

const writeState = async (stateFile: string, state: PluginStateFile): Promise<void> => {
  await mkdir(dirname(stateFile), { recursive: true })
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

const toStatus = (
  plugin: DiscoveredPlugin,
  appVersion: string,
  state: PluginStateFile
): PluginStatus => {
  const compatible = isEngineCompatible(plugin.manifest.engineRange, appVersion)
  return {
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    description: plugin.manifest.description,
    permissions: [...plugin.manifest.permissions],
    commands: plugin.manifest.contributes.commands.map((command) => ({ ...command })),
    views: plugin.manifest.contributes.views.map((view) => ({ ...view })),
    compatible,
    enabled: compatible && state.enabled[plugin.manifest.id] === true
  }
}

const toIssue = (issue: PluginDiscoveryIssue): PluginIssue => ({
  directoryName: issue.directoryName,
  message: issue.message
})

/** 读取当前插件目录与启用状态；不缓存，目录变化后下一次调用即可见 */
export const createPluginHost = (options: PluginHostOptions): PluginHost => {
  const list = async (): Promise<PluginListResult> => {
    const [discovery, state] = await Promise.all([
      discoverPlugins(options.root),
      readState(options.stateFile)
    ])
    return {
      plugins: discovery.plugins.map((plugin) => toStatus(plugin, options.appVersion, state)),
      issues: discovery.issues.map(toIssue)
    }
  }

  const setEnabled = async (id: string, enabled: boolean): Promise<PluginStatus> => {
    const discovery = await discoverPlugins(options.root)
    const plugin = discovery.plugins.find((item) => item.manifest.id === id)
    if (!plugin) throw new Error('插件不存在')

    const state = await readState(options.stateFile)
    if (enabled) {
      if (!isEngineCompatible(plugin.manifest.engineRange, options.appVersion)) {
        throw new Error('插件与当前版本不兼容')
      }
      state.enabled[id] = true
    } else {
      delete state.enabled[id]
    }

    await writeState(options.stateFile, state)
    return toStatus(plugin, options.appVersion, state)
  }

  const runtimePlugins = async (): Promise<PluginHostDescriptor[]> => {
    const [discovery, state] = await Promise.all([
      discoverPlugins(options.root),
      readState(options.stateFile)
    ])

    return discovery.plugins.flatMap((plugin) => {
      const { manifest } = plugin
      if (
        manifest.main === undefined ||
        state.enabled[manifest.id] !== true ||
        !isEngineCompatible(manifest.engineRange, options.appVersion)
      ) {
        return []
      }
      return [
        {
          id: manifest.id,
          entry: join(plugin.directory, manifest.main),
          permissions: [...manifest.permissions],
          activationEvents: [...manifest.activationEvents]
        }
      ]
    })
  }

  const findEnabledPlugin = async (pluginId: string): Promise<DiscoveredPlugin | null> => {
    const [discovery, state] = await Promise.all([
      discoverPlugins(options.root),
      readState(options.stateFile)
    ])
    const plugin = discovery.plugins.find((item) => item.manifest.id === pluginId)
    if (!plugin) return null
    if (state.enabled[pluginId] !== true) return null
    if (!isEngineCompatible(plugin.manifest.engineRange, options.appVersion)) return null
    return plugin
  }

  const resolveView = async (
    pluginId: string,
    viewId: string
  ): Promise<ResolvedPluginView | null> => {
    const plugin = await findEnabledPlugin(pluginId)
    if (!plugin) return null
    const view = plugin.manifest.contributes.views.find((item) => item.id === viewId)
    if (!view) return null
    return { view: { ...view }, permissions: [...plugin.manifest.permissions] }
  }

  const resolveAsset = async (
    pluginId: string,
    assetPath: string
  ): Promise<ResolvedPluginAsset | null> => {
    if (!isSafeRelativePath(assetPath)) return null
    const plugin = await findEnabledPlugin(pluginId)
    if (!plugin) return null

    let directory: string
    let filePath: string
    try {
      directory = await realpath(plugin.directory)
      filePath = await realpath(join(plugin.directory, assetPath))
    } catch {
      return null
    }

    const rel = relative(directory, filePath)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null

    try {
      const info = await stat(filePath)
      if (!info.isFile() || info.size > MAX_VIEW_ASSET_BYTES) return null
    } catch {
      return null
    }

    return { filePath, permissions: [...plugin.manifest.permissions] }
  }

  return { list, setEnabled, runtimePlugins, resolveView, resolveAsset }
}
