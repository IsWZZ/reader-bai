import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUserDataDir, launchReader, readJsonFile, removeUserDataDir } from './helpers'

interface PluginRuntimeState {
  pluginId: string
  status: 'inactive' | 'activating' | 'active' | 'error'
  message?: string
}

interface PluginRuntimeApi {
  getPluginRuntime: () => Promise<PluginRuntimeState[]>
}

interface ActivationResult {
  tools: string[]
  read: { content?: string; error?: string }
}

const PLUGIN_ID = 'reader-bai.echo'

const manifest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: PLUGIN_ID,
  name: 'Echo',
  version: '1.0.0',
  engines: { readerBai: '^1.0.0' },
  activationEvents: ['onStartup'],
  contributes: { commands: [] },
  permissions: ['documents:read'],
  main: 'index.js',
  ...overrides
})

const writePlugin = async (
  userDataDir: string,
  source: string,
  overrides: Record<string, unknown> = {}
): Promise<string> => {
  const directory = join(userDataDir, 'data', 'plugins', 'echo')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest(overrides)))
  await writeFile(join(directory, 'index.js'), source)
  return directory
}

const getRuntime = (page: Page): Promise<PluginRuntimeState[]> =>
  page.evaluate(async () => {
    const api = (globalThis as unknown as { api: PluginRuntimeApi }).api
    return api.getPluginRuntime()
  })

const READ_SOURCE = `
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

exports.activate = async (context) => {
  const tools = await context.tools.list()
  let read
  try {
    read = { content: (await context.tools.execute('library.list', {})).content }
  } catch (error) {
    read = { error: error.message }
  }
  writeFileSync(join(__dirname, 'activation.json'), JSON.stringify({
    tools: tools.map((tool) => tool.name),
    read
  }))
  context.log('info', 'activated')
}
`

const DENIED_SOURCE = `
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

exports.activate = async (context) => {
  const results = {}
  const calls = [
    ['library', 'library.list', {}],
    ['annotations', 'annotations.add', {
      paperId: 'paper-1',
      page: 1,
      text: 'x',
      rects: [{ x: 0, y: 0, width: 0.1, height: 0.1 }]
    }]
  ]
  for (const [key, name, input] of calls) {
    try {
      results[key] = { ok: true, content: (await context.tools.execute(name, input)).content }
    } catch (error) {
      results[key] = { ok: false, error: error.message }
    }
  }
  writeFileSync(join(__dirname, 'activation.json'), JSON.stringify(results))
}
`

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

test('activates enabled plugins and serves platform tools in the host process', async () => {
  const directory = await writePlugin(userDataDir, READ_SOURCE)
  await writeFile(
    join(userDataDir, 'data', 'plugins.json'),
    JSON.stringify({ enabled: { [PLUGIN_ID]: true } })
  )

  const { app, page } = await launchReader(userDataDir)

  await expect
    .poll(
      async () =>
        (await readJsonFile<ActivationResult>(join(directory, 'activation.json')))?.read.content ??
        ''
    )
    .toContain('"total":0')

  const data = await readJsonFile<ActivationResult>(join(directory, 'activation.json'))
  expect(data?.tools).toEqual(
    expect.arrayContaining(['library.list', 'paper.get', 'paper.readPage', 'annotations.add'])
  )
  expect(JSON.parse(data?.read.content ?? '{}')).toEqual({ total: 0, papers: [] })

  await expect
    .poll(async () => (await getRuntime(page)).map((state) => [state.pluginId, state.status]))
    .toEqual([[PLUGIN_ID, 'active']])

  await app.close()
})

test('denies platform tools whose manifest permissions are missing', async () => {
  const directory = await writePlugin(userDataDir, DENIED_SOURCE, { permissions: [] })
  await writeFile(
    join(userDataDir, 'data', 'plugins.json'),
    JSON.stringify({ enabled: { [PLUGIN_ID]: true } })
  )

  const { app, page } = await launchReader(userDataDir)

  await expect
    .poll(
      async () =>
        (
          await readJsonFile<Record<string, { ok: boolean; error?: string }>>(
            join(directory, 'activation.json')
          )
        )?.library.error
    )
    .toBe('插件缺少权限：documents:read')
  await expect
    .poll(
      async () =>
        (
          await readJsonFile<Record<string, { ok: boolean; error?: string }>>(
            join(directory, 'activation.json')
          )
        )?.annotations.error
    )
    .toBe('插件缺少权限：documents:read, annotations:write')

  await expect.poll(async () => (await getRuntime(page))[0]?.status).toBe('active')

  await app.close()
})

test('reports activation failures in the runtime state', async () => {
  await writePlugin(userDataDir, 'exports.other = true\n')
  await writeFile(
    join(userDataDir, 'data', 'plugins.json'),
    JSON.stringify({ enabled: { [PLUGIN_ID]: true } })
  )

  const { app, page } = await launchReader(userDataDir)

  await expect
    .poll(async () => getRuntime(page))
    .toEqual([
      {
        pluginId: PLUGIN_ID,
        status: 'error',
        message: '插件入口没有导出 activate'
      }
    ])

  await app.close()
})

test('starts a plugin after enabling it in settings', async () => {
  const directory = await writePlugin(userDataDir, READ_SOURCE)
  const { app, page } = await launchReader(userDataDir)

  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: '插件' }).click()
  await page.getByRole('checkbox', { name: '启用 Echo' }).check()

  await expect.poll(() => readJsonFile(join(directory, 'activation.json'))).not.toBeNull()
  await expect(page.getByTestId('plugin-runtime')).toContainText('运行中')

  await app.close()
})
