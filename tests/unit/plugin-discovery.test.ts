// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverPlugins } from '../../src/main/plugins/discovery'

const manifest = (id: string, name = id): Record<string, unknown> => ({
  id,
  name,
  version: '1.0.0',
  engines: { readerBai: '^1.0.0' },
  activationEvents: ['onStartup'],
  contributes: { commands: [] },
  permissions: []
})

const addPlugin = async (
  root: string,
  directoryName: string,
  value: Record<string, unknown>
): Promise<string> => {
  const directory = join(root, directoryName)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(value))
  return directory
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-bai-plugins-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('discoverPlugins', () => {
  it('returns an empty result when the plugin directory does not exist', async () => {
    await expect(discoverPlugins(join(root, 'missing'))).resolves.toEqual({
      plugins: [],
      issues: []
    })
  })

  it('loads valid plugins sorted by directory name', async () => {
    await addPlugin(root, 'zeta', manifest('reader-bai.zeta', 'Zeta'))
    await addPlugin(root, 'alpha', manifest('reader-bai.alpha', 'Alpha'))
    await writeFile(join(root, 'README.md'), 'not a plugin')

    const result = await discoverPlugins(root)

    expect(result.issues).toEqual([])
    expect(result.plugins.map((plugin) => plugin.manifest.name)).toEqual(['Alpha', 'Zeta'])
    expect(result.plugins[0].directory).toBe(join(root, 'alpha'))
  })

  it('skips symbolic links so plugins cannot escape the plugin root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'reader-bai-outside-'))
    try {
      await addPlugin(outside, 'linked', manifest('reader-bai.linked'))
      await symlink(join(outside, 'linked'), join(root, 'linked'), 'dir')

      const result = await discoverPlugins(root)

      expect(result.plugins).toEqual([])
      expect(result.issues).toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('reports one broken plugin without dropping the others', async () => {
    await addPlugin(root, 'good', manifest('reader-bai.good'))
    await addPlugin(root, 'bad', { ...manifest('reader-bai.bad'), permissions: ['shell'] })
    await mkdir(join(root, 'empty'))

    const result = await discoverPlugins(root)

    expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual(['reader-bai.good'])
    expect(result.issues).toEqual([
      expect.objectContaining({ directoryName: 'bad', message: '未知的插件权限：shell' }),
      expect.objectContaining({ directoryName: 'empty', message: '缺少 manifest.json' })
    ])
  })

  it('rejects invalid JSON and oversized manifests', async () => {
    const invalid = join(root, 'invalid')
    await mkdir(invalid)
    await writeFile(join(invalid, 'manifest.json'), '{ not json')

    const oversized = join(root, 'oversized')
    await mkdir(oversized)
    await writeFile(join(oversized, 'manifest.json'), 'x'.repeat(300 * 1024))

    const result = await discoverPlugins(root)

    expect(result.issues).toEqual([
      expect.objectContaining({
        directoryName: 'invalid',
        message: 'manifest.json 不是合法的 JSON'
      }),
      expect.objectContaining({ directoryName: 'oversized', message: 'manifest.json 过大' })
    ])
  })

  it('rejects duplicate plugin ids', async () => {
    await addPlugin(root, 'first', manifest('reader-bai.same'))
    await addPlugin(root, 'second', manifest('reader-bai.same'))

    const result = await discoverPlugins(root)

    expect(result.plugins.map((plugin) => plugin.directoryName)).toEqual(['first'])
    expect(result.issues).toEqual([
      expect.objectContaining({
        directoryName: 'second',
        message: '插件 id 重复：reader-bai.same'
      })
    ])
  })
})
