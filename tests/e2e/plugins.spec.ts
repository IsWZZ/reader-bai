import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUserDataDir, launchReader, readJsonFile, removeUserDataDir } from './helpers'

interface PluginInfo {
  id: string
  name: string
  enabled: boolean
  compatible: boolean
  permissions: string[]
}

interface PluginListResult {
  plugins: PluginInfo[]
  issues: { directoryName: string; message: string }[]
}

interface PluginApi {
  listPlugins: () => Promise<PluginListResult>
  setPluginEnabled: (id: string, enabled: boolean) => Promise<PluginInfo>
}

const listPlugins = (page: Page): Promise<PluginListResult> =>
  page.evaluate(async () => {
    const api = (globalThis as unknown as { api: PluginApi }).api
    return api.listPlugins()
  })

const setPluginEnabled = (page: Page, id: string, enabled: boolean): Promise<PluginInfo> =>
  page.evaluate(
    async ({ pluginId, flag }) => {
      const api = (globalThis as unknown as { api: PluginApi }).api
      return api.setPluginEnabled(pluginId, flag)
    },
    { pluginId: id, flag: enabled }
  )

const setPluginEnabledError = (page: Page, id: unknown, enabled: unknown): Promise<string | null> =>
  page.evaluate(
    async ({ pluginId, flag }) => {
      const api = (globalThis as unknown as { api: PluginApi }).api
      try {
        await api.setPluginEnabled(pluginId as string, flag as boolean)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    { pluginId: id, flag: enabled }
  )

const writePlugin = async (
  userDataDir: string,
  directoryName: string,
  manifest: Record<string, unknown>
): Promise<void> => {
  const directory = join(userDataDir, 'Userdata', 'plugins', directoryName)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
}

const manifest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'reader-bai.arxiv-source',
  name: 'arXiv',
  version: '1.0.0',
  engines: { readerBai: '^1.0.0' },
  activationEvents: ['onStartup'],
  contributes: { commands: [{ id: 'search.arxiv', title: '在 arXiv 中查找' }] },
  permissions: ['network'],
  ...overrides
})

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

test('discovers plugins disabled by default and persists the enabled state', async () => {
  await writePlugin(userDataDir, 'arxiv', manifest())
  const first = await launchReader(userDataDir)

  const initial = await listPlugins(first.page)
  expect(initial.plugins).toEqual([
    expect.objectContaining({
      id: 'reader-bai.arxiv-source',
      name: 'arXiv',
      enabled: false,
      compatible: true,
      permissions: ['network']
    })
  ])
  expect(initial.issues).toEqual([])

  await expect(
    setPluginEnabled(first.page, 'reader-bai.arxiv-source', true)
  ).resolves.toMatchObject({ enabled: true })
  expect(await readJsonFile(join(userDataDir, 'Userdata', 'plugins.json'))).toEqual({
    enabled: { 'reader-bai.arxiv-source': true }
  })
  await first.app.close()

  const second = await launchReader(userDataDir)
  expect((await listPlugins(second.page)).plugins[0].enabled).toBe(true)
  await setPluginEnabled(second.page, 'reader-bai.arxiv-source', false)
  expect(await readJsonFile(join(userDataDir, 'Userdata', 'plugins.json'))).toEqual({ enabled: {} })
  await second.app.close()
})

test('manages plugins from the settings dialog', async () => {
  await writePlugin(userDataDir, 'arxiv', manifest())
  await writePlugin(userDataDir, 'broken', { id: 'bad' })
  const { app, page } = await launchReader(userDataDir)

  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: '插件' }).click()

  await expect(page.getByText('reader-bai.arxiv-source')).toBeVisible()
  await expect(page.getByText('broken：manifest.id 格式不正确')).toBeVisible()

  const toggle = page.getByRole('checkbox', { name: '启用 arXiv' })
  await expect(toggle).not.toBeChecked()
  await toggle.check()

  await expect
    .poll(async () => readJsonFile(join(userDataDir, 'Userdata', 'plugins.json')))
    .toEqual({
      enabled: { 'reader-bai.arxiv-source': true }
    })
  await expect(toggle).toBeChecked()

  await app.close()
})

test('reports broken manifests, incompatible plugins and invalid requests', async () => {
  await writePlugin(userDataDir, 'future', {
    ...manifest({ id: 'reader-bai.future', engines: { readerBai: '^9.0.0' } })
  })
  await writePlugin(userDataDir, 'broken', { id: 'bad' })
  const { app, page } = await launchReader(userDataDir)

  const result = await listPlugins(page)
  expect(result.plugins).toEqual([
    expect.objectContaining({ id: 'reader-bai.future', compatible: false, enabled: false })
  ])
  expect(result.issues).toEqual([
    expect.objectContaining({ directoryName: 'broken', message: 'manifest.id 格式不正确' })
  ])

  expect(await setPluginEnabledError(page, 1, true)).toContain('插件 id 不正确')
  expect(await setPluginEnabledError(page, 'reader-bai.future', 'yes')).toContain('启用状态不正确')
  expect(await setPluginEnabledError(page, 'reader-bai.missing', true)).toContain('插件不存在')
  expect(await setPluginEnabledError(page, 'reader-bai.future', true)).toContain(
    '插件与当前版本不兼容'
  )
  expect(await readJsonFile(join(userDataDir, 'Userdata', 'plugins.json'))).toBeNull()

  await app.close()
})
