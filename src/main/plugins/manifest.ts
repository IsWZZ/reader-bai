// C 层第三方插件 manifest 的解析与校验。
// 这里定义平台认识的字段集合：未识别的字段直接拒绝，避免插件携带隐藏配置；
// 声明了权限也不等于已授权，实际执行时仍由平台按 manifest 逐项检查。

export const PLUGIN_PERMISSIONS = [
  'documents:read',
  'annotations:write',
  'network',
  'storage'
] as const
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

export const STARTUP_ACTIVATION = 'onStartup'
export const commandActivation = (commandId: string): string => `onCommand:${commandId}`

const MAX_ID_LENGTH = 100
const MAX_NAME_LENGTH = 80
const MAX_DESCRIPTION_LENGTH = 500
const MAX_VERSION_LENGTH = 40
const MAX_MAIN_LENGTH = 200
const MAX_ACTIVATION_EVENTS = 50
const MAX_COMMANDS = 50
const MAX_TITLE_LENGTH = 100
// 插件 id 固定为 publisher.name 两段，命令 id 允许多段
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/
const COMMAND_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const ENGINE_PATTERN = /^(?:\^|~)?\d+\.\d+\.\d+$/
const TOP_LEVEL_KEYS = new Set([
  'id',
  'name',
  'version',
  'description',
  'engines',
  'activationEvents',
  'contributes',
  'permissions',
  'main'
])
const ENGINE_KEYS = new Set(['readerBai'])
const CONTRIBUTION_KEYS = new Set(['commands'])
const COMMAND_KEYS = new Set(['id', 'title', 'description'])

export interface PluginCommandContribution {
  id: string
  title: string
  description?: string
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  /** 支持的宿主版本范围，如 ^1.0.0 */
  engineRange: string
  /** onStartup 或 onCommand:<id> */
  activationEvents: string[]
  contributes: {
    commands: PluginCommandContribution[]
  }
  /** 声明需要的权限；未声明的能力一律不可用 */
  permissions: PluginPermission[]
  /** 插件入口文件，相对插件目录 */
  main?: string
}

export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginManifestError'
  }
}

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginManifestError(`${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

const assertKnownKeys = (
  record: Record<string, unknown>,
  allowed: Set<string>,
  label: string
): void => {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new PluginManifestError(`${label} 包含未知字段：${key}`)
  }
}

const readRequiredString = (
  record: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number
): string => {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginManifestError(`${label} 必须是非空字符串`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new PluginManifestError(`${label} 过长`)
  return trimmed
}

const readOptionalString = (
  record: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number
): string | undefined => {
  const value = record[key]
  if (value === undefined) return undefined
  return readRequiredString(record, key, label, maxLength)
}

const assertCommandId = (value: string, label: string): void => {
  if (!COMMAND_ID_PATTERN.test(value)) throw new PluginManifestError(`${label} 格式不正确`)
}

/** 入口路径必须留在插件目录内，拒绝绝对路径和 .. 片段 */
export const isSafeRelativePath = (value: string): boolean => {
  if (!value || value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/.test(value)) {
    return false
  }
  return value
    .replace(/\\/g, '/')
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

const parsePermissions = (raw: unknown): PluginPermission[] => {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new PluginManifestError('manifest.permissions 必须是数组')
  if (raw.length > PLUGIN_PERMISSIONS.length) {
    throw new PluginManifestError('manifest.permissions 数量超过允许值')
  }

  const permissions = raw.map((item) => {
    if (typeof item !== 'string' || !(PLUGIN_PERMISSIONS as readonly string[]).includes(item)) {
      throw new PluginManifestError(`未知的插件权限：${String(item)}`)
    }
    return item as PluginPermission
  })
  if (new Set(permissions).size !== permissions.length) {
    throw new PluginManifestError('manifest.permissions 不能重复')
  }
  return permissions
}

const parseActivationEvents = (raw: unknown): string[] => {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PluginManifestError('manifest.activationEvents 必须是非空数组')
  }
  if (raw.length > MAX_ACTIVATION_EVENTS) {
    throw new PluginManifestError('manifest.activationEvents 数量超过允许值')
  }

  const events = raw.map((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new PluginManifestError('manifest.activationEvents 的每一项必须是非空字符串')
    }
    const event = item.trim()
    if (event === STARTUP_ACTIVATION) return event
    if (event.startsWith('onCommand:')) {
      assertCommandId(event.slice('onCommand:'.length), `激活事件 ${event}`)
      return event
    }
    throw new PluginManifestError(`不支持的激活事件：${event}`)
  })
  if (new Set(events).size !== events.length) {
    throw new PluginManifestError('manifest.activationEvents 不能重复')
  }
  return events
}

const parseCommands = (raw: unknown): PluginCommandContribution[] => {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new PluginManifestError('contributes.commands 必须是数组')
  if (raw.length > MAX_COMMANDS) {
    throw new PluginManifestError('contributes.commands 数量超过允许值')
  }

  const commands = raw.map((item, index) => {
    const label = `contributes.commands[${index}]`
    const command = asRecord(item, label)
    assertKnownKeys(command, COMMAND_KEYS, label)
    const id = readRequiredString(command, 'id', `${label}.id`, MAX_ID_LENGTH)
    assertCommandId(id, `${label}.id`)
    return {
      id,
      title: readRequiredString(command, 'title', `${label}.title`, MAX_TITLE_LENGTH),
      description: readOptionalString(
        command,
        'description',
        `${label}.description`,
        MAX_DESCRIPTION_LENGTH
      )
    }
  })

  const ids = commands.map((command) => command.id)
  if (new Set(ids).size !== ids.length) {
    throw new PluginManifestError('contributes.commands 的 id 不能重复')
  }
  return commands
}

/** 解析并校验 manifest；任何不认识的字段或格式错误都会直接拒绝 */
export const parsePluginManifest = (value: unknown): PluginManifest => {
  const record = asRecord(value, 'manifest')
  assertKnownKeys(record, TOP_LEVEL_KEYS, 'manifest')

  const id = readRequiredString(record, 'id', 'manifest.id', MAX_ID_LENGTH)
  if (!ID_PATTERN.test(id)) throw new PluginManifestError('manifest.id 格式不正确')

  const name = readRequiredString(record, 'name', 'manifest.name', MAX_NAME_LENGTH)
  const version = readRequiredString(record, 'version', 'manifest.version', MAX_VERSION_LENGTH)
  if (!VERSION_PATTERN.test(version)) throw new PluginManifestError('manifest.version 格式不正确')

  const engines = asRecord(record.engines, 'manifest.engines')
  assertKnownKeys(engines, ENGINE_KEYS, 'manifest.engines')
  const engineRange = readRequiredString(
    engines,
    'readerBai',
    'manifest.engines.readerBai',
    MAX_VERSION_LENGTH
  )
  if (!ENGINE_PATTERN.test(engineRange)) {
    throw new PluginManifestError('manifest.engines.readerBai 格式不正确')
  }

  const activationEvents = parseActivationEvents(record.activationEvents)
  const contributes =
    record.contributes === undefined ? {} : asRecord(record.contributes, 'manifest.contributes')
  assertKnownKeys(contributes, CONTRIBUTION_KEYS, 'manifest.contributes')
  const commands = parseCommands(contributes.commands)

  const startup = activationEvents.includes(STARTUP_ACTIVATION)
  for (const command of commands) {
    if (!startup && !activationEvents.includes(commandActivation(command.id))) {
      throw new PluginManifestError(`命令 ${command.id} 没有对应的激活事件`)
    }
  }

  const main = readOptionalString(record, 'main', 'manifest.main', MAX_MAIN_LENGTH)
  if (main !== undefined && !isSafeRelativePath(main)) {
    throw new PluginManifestError('manifest.main 必须是插件目录内的相对路径')
  }

  return {
    id,
    name,
    version,
    description: readOptionalString(
      record,
      'description',
      'manifest.description',
      MAX_DESCRIPTION_LENGTH
    ),
    engineRange,
    activationEvents,
    contributes: { commands },
    permissions: parsePermissions(record.permissions),
    main
  }
}

/** 启动时激活，或该命令对应的 onCommand 事件被触发 */
export const manifestHandlesCommand = (manifest: PluginManifest, commandId: string): boolean =>
  manifest.activationEvents.includes(STARTUP_ACTIVATION) ||
  manifest.activationEvents.includes(commandActivation(commandId))

interface Semver {
  major: number
  minor: number
  patch: number
}

const parseSemver = (value: string): Semver | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

const compareSemver = (left: Semver, right: Semver): number =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch

/** 支持 ^x.y.z、~x.y.z 和精确版本；宿主版本不在范围内时插件不会被激活 */
export const isEngineCompatible = (range: string, appVersion: string): boolean => {
  const target = parseSemver(appVersion)
  const trimmed = range.trim()
  const operator = trimmed[0]
  const minimum = parseSemver(trimmed.replace(/^[\^~]/, ''))
  if (!target || !minimum) return false
  if (operator === '^') {
    if (compareSemver(target, minimum) < 0) return false
    if (minimum.major > 0) return target.major === minimum.major
    if (minimum.minor > 0) return target.major === 0 && target.minor === minimum.minor
    return target.major === 0 && target.minor === 0 && target.patch === minimum.patch
  }
  if (operator === '~') {
    if (compareSemver(target, minimum) < 0) return false
    return target.major === minimum.major && target.minor === minimum.minor
  }
  return compareSemver(target, minimum) === 0
}
