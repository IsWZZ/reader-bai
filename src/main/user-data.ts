// 用户数据的统一根目录。
// Electron/Chromium 会在 userData 根目录写大量缓存和配置，平台自己的文件
// 统一放进 userData/data，方便用户备份、迁移和清理，也避免和 Electron 文件混在一起。

import { access, mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join, relative, resolve } from 'path'
import { isInsideDirectory } from './library'

export const USER_DATA_DIRECTORY = 'data'

export interface UserDataPaths {
  /** userData/data */
  dataRoot: string
  libraryFile: string
  annotationsFile: string
  settingsFile: string
  pluginsStateFile: string
  pluginsDirectory: string
  papersDirectory: string
}

export const createUserDataPaths = (userDataRoot: string): UserDataPaths => {
  const dataRoot = join(userDataRoot, USER_DATA_DIRECTORY)
  return {
    dataRoot,
    libraryFile: join(dataRoot, 'library.json'),
    annotationsFile: join(dataRoot, 'annotations.json'),
    settingsFile: join(dataRoot, 'settings.json'),
    pluginsStateFile: join(dataRoot, 'plugins.json'),
    pluginsDirectory: join(dataRoot, 'plugins'),
    papersDirectory: join(dataRoot, 'papers')
  }
}

export interface PathRewriteResult {
  value: unknown
  changed: boolean
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const samePath = (left: string, right: string): boolean => resolve(left) === resolve(right)

const rebasePath = (value: string, from: string, to: string): string => {
  if (!isInsideDirectory(from, value)) return value
  return join(to, relative(from, value))
}

const rewritePaperPaths = (paper: unknown, from: string, to: string): boolean => {
  if (!paper || typeof paper !== 'object' || Array.isArray(paper)) return false
  const record = paper as Record<string, unknown>
  let changed = false
  for (const key of ['path', 'sourcePath'] as const) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const next = rebasePath(value, from, to)
    if (next !== value) {
      record[key] = next
      changed = true
    }
  }
  return changed
}

/** 重写 library.json 中位于旧论文库目录下的 path / sourcePath；兼容旧版纯数组格式 */
export const rewriteLibraryPaths = (raw: unknown, from: string, to: string): PathRewriteResult => {
  let changed = false
  if (Array.isArray(raw)) {
    for (const paper of raw) changed = rewritePaperPaths(paper, from, to) || changed
  } else if (raw && typeof raw === 'object') {
    const papers = (raw as Record<string, unknown>).papers
    if (Array.isArray(papers)) {
      for (const paper of papers) changed = rewritePaperPaths(paper, from, to) || changed
    }
  }
  return { value: raw, changed }
}

/** 重写以论文绝对路径为键的 annotations.json；同一新键出现时合并数组 */
export const rewriteAnnotationKeys = (
  raw: unknown,
  from: string,
  to: string
): PathRewriteResult => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: raw, changed: false }
  }

  const result: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const next = rebasePath(key, from, to)
    if (next !== key) changed = true
    if (!(next in result)) {
      result[next] = value
    } else if (Array.isArray(result[next]) && Array.isArray(value)) {
      result[next] = [...(result[next] as unknown[]), ...value]
    } else {
      result[next] = value
    }
  }
  return { value: result, changed }
}

/** 如果用户显式把论文库目录设成了旧默认目录，迁移时同步改到新默认目录 */
export const rewriteLibraryDirectory = (
  raw: unknown,
  from: string,
  to: string
): PathRewriteResult => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: raw, changed: false }
  }
  const library = (raw as Record<string, unknown>).library
  if (!library || typeof library !== 'object' || Array.isArray(library)) {
    return { value: raw, changed: false }
  }
  const record = library as Record<string, unknown>
  if (typeof record.directory !== 'string' || !record.directory) {
    return { value: raw, changed: false }
  }
  if (!samePath(record.directory, from)) return { value: raw, changed: false }
  record.directory = to
  return { value: raw, changed: true }
}

const rewriteJsonFile = async (
  file: string,
  rewrite: (raw: unknown) => PathRewriteResult
): Promise<boolean> => {
  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch {
    return false
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    // 文件损坏时保持原样，避免迁移过程把最后一份数据也写坏
    return false
  }

  const { value, changed } = rewrite(parsed)
  if (!changed) return false
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8')
  return true
}

interface LegacyEntry {
  name: string
  destination: string
}

const legacyEntries = (paths: UserDataPaths): LegacyEntry[] => [
  { name: 'library.json', destination: paths.libraryFile },
  { name: 'annotations.json', destination: paths.annotationsFile },
  { name: 'settings.json', destination: paths.settingsFile },
  { name: 'plugins.json', destination: paths.pluginsStateFile },
  { name: 'papers', destination: paths.papersDirectory },
  { name: 'plugins', destination: paths.pluginsDirectory }
]

export interface UserDataMigrationResult {
  migrated: string[]
  skipped: string[]
}

/**
 * 把旧版直接放在 userData 根目录的数据移动到 userData/data。
 * 已存在的新文件不覆盖；单个条目迁移失败会向上抛出，避免应用带着空数据启动。
 * 论文目录移动后同步重写 library.json、annotations.json 和 settings.json 中的旧路径。
 */
export const migrateLegacyUserData = async (
  userDataRoot: string
): Promise<UserDataMigrationResult> => {
  const paths = createUserDataPaths(userDataRoot)
  await mkdir(paths.dataRoot, { recursive: true })

  const migrated: string[] = []
  const skipped: string[] = []

  for (const entry of legacyEntries(paths)) {
    const source = join(userDataRoot, entry.name)
    if (!(await exists(source))) continue
    if (await exists(entry.destination)) {
      skipped.push(entry.name)
      continue
    }
    await rename(source, entry.destination)
    migrated.push(entry.name)
  }

  // 旧论文目录已经不存在、新目录存在时，说明移动已完成；
  // 这里每次都执行，保证上次中断的路径重写可以在下次启动继续。
  const legacyPapers = join(userDataRoot, 'papers')
  if (!(await exists(legacyPapers)) && (await exists(paths.papersDirectory))) {
    await rewriteJsonFile(paths.libraryFile, (raw) =>
      rewriteLibraryPaths(raw, legacyPapers, paths.papersDirectory)
    )
    await rewriteJsonFile(paths.annotationsFile, (raw) =>
      rewriteAnnotationKeys(raw, legacyPapers, paths.papersDirectory)
    )
    await rewriteJsonFile(paths.settingsFile, (raw) =>
      rewriteLibraryDirectory(raw, legacyPapers, paths.papersDirectory)
    )
  }

  return { migrated, skipped }
}
