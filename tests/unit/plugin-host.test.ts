// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPluginHost, type PluginHost } from '../../src/main/plugins/host'

const manifest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'reader-bai.arxiv-source',
  name: 'arXiv',
  version: '1.0.0',
  description: 'arXiv 检索源',
  engines: { readerBai: '^1.0.0' },
  activationEvents: ['onStartup'],
  contributes: {
    commands: [{ id: 'search.arxiv', title: '在 arXiv 中查找' }]
  },
  permissions: ['network', 'storage'],
  ...overrides
})

const writePlugin = async (
  root: string,
  directoryName: string,
  value: Record<string, unknown>
): Promise<void> => {
  const directory = join(root, directoryName)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(value))
}

let root: string
let stateFile: string
let host: PluginHost

const createHost = (appVersion = '1.0.0'): PluginHost =>
  createPluginHost({ root, stateFile, appVersion })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-bai-plugin-host-'))
  stateFile = join(root, 'plugins.json')
  host = createHost()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('plugin host', () => {
  it('lists discovered plugins disabled by default', async () => {
    await writePlugin(root, 'arxiv', manifest())
    await writePlugin(root, 'broken', { id: 'bad' })

    const result = await host.list()

    expect(result.plugins).toEqual([
      {
        id: 'reader-bai.arxiv-source',
        name: 'arXiv',
        version: '1.0.0',
        description: 'arXiv 检索源',
        permissions: ['network', 'storage'],
        commands: [{ id: 'search.arxiv', title: '在 arXiv 中查找' }],
        compatible: true,
        enabled: false
      }
    ])
    expect(result.issues).toEqual([
      expect.objectContaining({ directoryName: 'broken', message: 'manifest.id 格式不正确' })
    ])
    expect(JSON.stringify(result)).not.toContain(root)
  })

  it('restores the enabled state from disk', async () => {
    await writePlugin(root, 'arxiv', manifest())
    await writeFile(stateFile, JSON.stringify({ enabled: { 'reader-bai.arxiv-source': true } }))

    const result = await createHost().list()
    expect(result.plugins[0].enabled).toBe(true)
  })

  it('ignores malformed state files and non-true flags', async () => {
    await writePlugin(root, 'arxiv', manifest())
    await writeFile(stateFile, '{ broken')

    expect((await host.list()).plugins[0].enabled).toBe(false)

    await writeFile(
      stateFile,
      JSON.stringify({ enabled: { 'reader-bai.arxiv-source': 'yes', other: true } })
    )
    expect((await host.list()).plugins[0].enabled).toBe(false)
  })

  it('persists enable and disable', async () => {
    await writePlugin(root, 'arxiv', manifest())

    expect(await host.setEnabled('reader-bai.arxiv-source', true)).toMatchObject({ enabled: true })
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual({
      enabled: { 'reader-bai.arxiv-source': true }
    })
    expect((await createHost().list()).plugins[0].enabled).toBe(true)

    expect(await host.setEnabled('reader-bai.arxiv-source', false)).toMatchObject({
      enabled: false
    })
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual({ enabled: {} })
    expect((await createHost().list()).plugins[0].enabled).toBe(false)
  })

  it('rejects unknown plugins', async () => {
    await expect(host.setEnabled('reader-bai.missing', true)).rejects.toThrow('插件不存在')
  })

  it('keeps incompatible plugins disabled and refuses to enable them', async () => {
    await writePlugin(root, 'arxiv', manifest({ engines: { readerBai: '^2.0.0' } }))
    await writeFile(stateFile, JSON.stringify({ enabled: { 'reader-bai.arxiv-source': true } }))

    const incompatible = createHost('1.0.0')
    const result = await incompatible.list()
    expect(result.plugins[0]).toMatchObject({ compatible: false, enabled: false })
    await expect(incompatible.setEnabled('reader-bai.arxiv-source', true)).rejects.toThrow(
      '插件与当前版本不兼容'
    )
  })
})
