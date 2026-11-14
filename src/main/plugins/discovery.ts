// 扫描插件目录，读取并校验每个插件的 manifest。
// 这里只做发现，不加载插件代码；单个插件出错只记录 issue，不影响其他插件和主程序启动。

import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { parsePluginManifest, type PluginManifest } from './manifest'

export const MANIFEST_FILE = 'manifest.json'
const MAX_MANIFEST_BYTES = 256 * 1024

export interface DiscoveredPlugin {
  /** 插件目录名，仅用于展示和诊断；稳定标识是 manifest.id */
  directoryName: string
  directory: string
  manifest: PluginManifest
}

export interface PluginDiscoveryIssue {
  directoryName: string
  directory: string
  message: string
}

export interface PluginDiscoveryResult {
  plugins: DiscoveredPlugin[]
  issues: PluginDiscoveryIssue[]
}

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const readManifest = async (directory: string): Promise<PluginManifest> => {
  const manifestPath = join(directory, MANIFEST_FILE)
  let info
  try {
    info = await stat(manifestPath)
  } catch (error) {
    if (isNotFound(error)) throw new Error(`缺少 ${MANIFEST_FILE}`, { cause: error })
    throw error
  }
  if (!info.isFile()) throw new Error(`${MANIFEST_FILE} 不是文件`)
  if (info.size > MAX_MANIFEST_BYTES) throw new Error(`${MANIFEST_FILE} 过大`)

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${MANIFEST_FILE} 不是合法的 JSON`, { cause: error })
    }
    throw error
  }
  return parsePluginManifest(parsed)
}

/**
 * 只扫描真实子目录；符号链接一律跳过，避免插件通过链接读取目录外的文件。
 * 目录不存在时返回空结果，插件目录按需创建。
 */
export const discoverPlugins = async (root: string): Promise<PluginDiscoveryResult> => {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) return { plugins: [], issues: [] }
    throw error
  }

  const plugins: DiscoveredPlugin[] = []
  const issues: PluginDiscoveryIssue[] = []
  const seenIds = new Set<string>()

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const directory = join(root, entry.name)
    try {
      const manifest = await readManifest(directory)
      if (seenIds.has(manifest.id)) throw new Error(`插件 id 重复：${manifest.id}`)
      seenIds.add(manifest.id)
      plugins.push({ directoryName: entry.name, directory, manifest })
    } catch (error) {
      issues.push({ directoryName: entry.name, directory, message: describeError(error) })
    }
  }

  return { plugins, issues }
}
