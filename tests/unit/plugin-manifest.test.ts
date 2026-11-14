// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  isEngineCompatible,
  manifestHandlesCommand,
  parsePluginManifest,
  type PluginManifest,
  type PluginManifestError
} from '../../src/main/plugins/manifest'

const base = (): Record<string, unknown> => ({
  id: 'reader-bai.arxiv-source',
  name: 'arXiv',
  version: '1.0.0',
  engines: { readerBai: '^1.0.0' },
  activationEvents: ['onCommand:search.arxiv'],
  contributes: { commands: [{ id: 'search.arxiv', title: '在 arXiv 中查找' }] },
  permissions: ['network', 'storage']
})

const expectInvalid = (manifest: unknown, message: string): void => {
  expect(() => parsePluginManifest(manifest)).toThrow(message)
}

describe('parsePluginManifest', () => {
  it('parses and normalizes a valid manifest', () => {
    const manifest = base()
    manifest.name = '  arXiv  '
    manifest.description = '  arXiv 检索源  '

    expect(parsePluginManifest(manifest)).toEqual({
      id: 'reader-bai.arxiv-source',
      name: 'arXiv',
      version: '1.0.0',
      description: 'arXiv 检索源',
      engineRange: '^1.0.0',
      activationEvents: ['onCommand:search.arxiv'],
      contributes: { commands: [{ id: 'search.arxiv', title: '在 arXiv 中查找' }] },
      permissions: ['network', 'storage'],
      main: undefined
    })
  })

  it('defaults missing contributions and permissions', () => {
    const manifest = base()
    manifest.activationEvents = ['onStartup']
    delete manifest.contributes
    delete manifest.permissions

    const parsed = parsePluginManifest(manifest)
    expect(parsed.contributes).toEqual({ commands: [] })
    expect(parsed.permissions).toEqual([])
  })

  it('rejects unknown fields instead of silently ignoring them', () => {
    expectInvalid({ ...base(), hooks: {} }, '未知字段：hooks')
    expectInvalid(
      { ...base(), engines: { readerBai: '^1.0.0', electron: '30' } },
      '未知字段：electron'
    )
    expectInvalid(
      {
        ...base(),
        contributes: { commands: [], panels: [] }
      },
      '未知字段：panels'
    )
    expectInvalid(
      {
        ...base(),
        contributes: { commands: [{ id: 'search.arxiv', title: 'x', icon: 'x' }] }
      },
      '未知字段：icon'
    )
  })

  it('validates identity fields', () => {
    expectInvalid({ ...base(), id: 'arxiv' }, 'manifest.id 格式不正确')
    expectInvalid({ ...base(), id: 'reader-bai.arxiv-source.v2.0' }, 'manifest.id 格式不正确')
    expectInvalid({ ...base(), id: 'Reader-bai.arxiv' }, 'manifest.id 格式不正确')
    expectInvalid({ ...base(), name: '' }, 'manifest.name 必须是非空字符串')
    expectInvalid({ ...base(), version: '1.0' }, 'manifest.version 格式不正确')
    expectInvalid({ ...base(), engines: {} }, 'manifest.engines.readerBai 必须是非空字符串')
    expectInvalid({ ...base(), engines: { readerBai: '>=1.0' } }, '格式不正确')
    expectInvalid({ ...base(), engines: [] }, 'manifest.engines 必须是对象')
  })

  it('validates activation events', () => {
    expectInvalid({ ...base(), activationEvents: [] }, '必须是非空数组')
    expectInvalid({ ...base(), activationEvents: 'onStartup' }, '必须是非空数组')
    expectInvalid({ ...base(), activationEvents: ['onSave'] }, '不支持的激活事件：onSave')
    expectInvalid(
      { ...base(), activationEvents: ['onCommand:search.arxiv', 'onCommand:search.arxiv'] },
      '不能重复'
    )
    expectInvalid({ ...base(), activationEvents: ['onCommand:arxiv'] }, '格式不正确')
  })

  it('requires every contributed command to be activatable', () => {
    expectInvalid(
      {
        ...base(),
        activationEvents: ['onCommand:search.semantic'],
        contributes: {
          commands: [
            { id: 'search.arxiv', title: 'arXiv' },
            { id: 'search.semantic', title: 'Semantic Scholar' }
          ]
        }
      },
      '命令 search.arxiv 没有对应的激活事件'
    )

    expect(
      parsePluginManifest({
        ...base(),
        activationEvents: ['onStartup'],
        contributes: {
          commands: [
            { id: 'search.arxiv', title: 'arXiv' },
            { id: 'search.semantic', title: 'Semantic Scholar' }
          ]
        }
      }).contributes.commands
    ).toHaveLength(2)
  })

  it('rejects duplicate commands and malformed titles', () => {
    expectInvalid(
      {
        ...base(),
        contributes: {
          commands: [
            { id: 'search.arxiv', title: 'A' },
            { id: 'search.arxiv', title: 'B' }
          ]
        }
      },
      'id 不能重复'
    )
    expectInvalid(
      { ...base(), contributes: { commands: [{ id: 'search.arxiv', title: '' }] } },
      'title 必须是非空字符串'
    )
  })

  it('keeps the entry point inside the plugin directory', () => {
    expect(parsePluginManifest({ ...base(), main: 'dist/index.js' }).main).toBe('dist/index.js')
    expectInvalid({ ...base(), main: '../outside.js' }, '必须是插件目录内的相对路径')
    expectInvalid({ ...base(), main: '/tmp/plugin.js' }, '必须是插件目录内的相对路径')
    expectInvalid({ ...base(), main: 'C:\\plugin.js' }, '必须是插件目录内的相对路径')
    expectInvalid({ ...base(), main: 'dist//index.js' }, '必须是插件目录内的相对路径')
  })

  it('rejects undeclared or duplicate permissions', () => {
    expectInvalid({ ...base(), permissions: ['shell'] }, '未知的插件权限：shell')
    expectInvalid({ ...base(), permissions: ['storage', 'storage'] }, '不能重复')
    expectInvalid({ ...base(), permissions: 'network' }, '必须是数组')
  })
})

describe('manifestHandlesCommand', () => {
  const manifest = (): PluginManifest => parsePluginManifest(base())

  it('matches the declared command activation event', () => {
    expect(manifestHandlesCommand(manifest(), 'search.arxiv')).toBe(true)
    expect(manifestHandlesCommand(manifest(), 'search.semantic')).toBe(false)
  })

  it('treats onStartup as handling every command', () => {
    const startup = manifest()
    startup.activationEvents = ['onStartup']
    expect(manifestHandlesCommand(startup, 'anything.at.all')).toBe(true)
  })
})

describe('isEngineCompatible', () => {
  it('honors caret ranges', () => {
    expect(isEngineCompatible('^1.0.0', '1.0.0')).toBe(true)
    expect(isEngineCompatible('^1.0.0', '1.4.2')).toBe(true)
    expect(isEngineCompatible('^1.0.0', '2.0.0')).toBe(false)
    expect(isEngineCompatible('^1.2.0', '1.1.9')).toBe(false)
    expect(isEngineCompatible('^0.2.0', '0.2.5')).toBe(true)
    expect(isEngineCompatible('^0.2.0', '0.3.0')).toBe(false)
  })

  it('honors tilde ranges and exact versions', () => {
    expect(isEngineCompatible('~1.2.0', '1.2.9')).toBe(true)
    expect(isEngineCompatible('~1.2.0', '1.3.0')).toBe(false)
    expect(isEngineCompatible('1.0.0', '1.0.0')).toBe(true)
    expect(isEngineCompatible('1.0.0', '1.0.1')).toBe(false)
  })

  it('rejects unparseable versions', () => {
    expect(isEngineCompatible('^1.0.0', 'dev')).toBe(false)
    expect(isEngineCompatible('latest', '1.0.0')).toBe(false)
  })
})

describe('PluginManifestError', () => {
  it('is identifiable for install diagnostics', () => {
    try {
      parsePluginManifest({})
      expect.unreachable()
    } catch (error) {
      expect((error as PluginManifestError).name).toBe('PluginManifestError')
    }
  })
})
