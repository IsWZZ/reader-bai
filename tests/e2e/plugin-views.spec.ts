import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUserDataDir, launchReader, removeUserDataDir } from './helpers'

interface ViewPluginOptions {
  id: string
  name: string
  title: string
  permissions?: string[]
  appJs: string
}

let userDataDir: string

const writePlugin = async (options: ViewPluginOptions): Promise<void> => {
  const directory = join(userDataDir, 'Userdata', 'plugins', options.id.replace('.', '-'))
  await mkdir(join(directory, 'ui'), { recursive: true })
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      id: options.id,
      name: options.name,
      version: '1.0.0',
      engines: { readerBai: '^1.0.0' },
      activationEvents: ['onStartup'],
      contributes: {
        views: [
          {
            id: `${options.id}.panel`,
            title: options.title,
            location: 'main',
            entry: 'ui/index.html'
          }
        ]
      },
      ...(options.permissions ? { permissions: options.permissions } : {})
    }),
    'utf8'
  )
  await writeFile(
    join(directory, 'ui', 'index.html'),
    `<!doctype html>
<html>
  <body>
    <h1>Plugin UI loaded</h1>
    <p id="init">no-init</p>
    <p id="tools">pending</p>
    <script src="./app.js"></script>
  </body>
</html>`,
    'utf8'
  )
  await writeFile(join(directory, 'ui', 'app.js'), options.appJs, 'utf8')
  await writeFile(
    join(userDataDir, 'Userdata', 'plugins.json'),
    JSON.stringify({ enabled: { [options.id]: true } }),
    'utf8'
  )
}

const listToolsScript = `
const init = document.getElementById('init')
const tools = document.getElementById('tools')
parent.postMessage({ type: 'reader-bai:request', requestId: 'tools-1', method: 'tools.list' }, '*')
window.addEventListener('message', (event) => {
  const data = event.data
  if (data && data.type === 'reader-bai:init') init.textContent = 'init:' + data.theme
  if (data && data.type === 'reader-bai:response' && data.requestId === 'tools-1') {
    tools.textContent = data.ok
      ? 'tools:' + data.result.map((tool) => tool.name).join(',')
      : 'error:' + data.error
  }
})
`

const executeToolScript = `
const tools = document.getElementById('tools')
parent.postMessage({
  type: 'reader-bai:request',
  requestId: 'exec-1',
  method: 'tools.execute',
  params: { name: 'library.list', input: {} }
}, '*')
window.addEventListener('message', (event) => {
  const data = event.data
  if (data && data.type === 'reader-bai:response' && data.requestId === 'exec-1') {
    tools.textContent = data.ok ? 'ok' : 'error:' + data.error
  }
})
`

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

test('renders a sandboxed plugin view and forwards allowed tool requests', async () => {
  await writePlugin({
    id: 'reader-bai.view-demo',
    name: 'View Demo',
    title: '演示面板',
    permissions: ['documents:read'],
    appJs: listToolsScript
  })

  const reader = await launchReader(userDataDir)
  const button = reader.page.getByRole('button', { name: 'View Demo · 演示面板' })
  await expect(button).toBeVisible()
  await button.click()

  const frame = reader.page.frameLocator('iframe[title="View Demo · 演示面板"]')
  await expect(frame.getByText('Plugin UI loaded')).toBeVisible()
  await expect(frame.locator('#init')).toHaveText('init:light')
  await expect(frame.locator('#tools')).toContainText('tools:library.list')

  await reader.page.getByRole('button', { name: '关闭插件面板' }).click()
  await expect(reader.page.locator('iframe[title="View Demo · 演示面板"]')).toHaveCount(0)

  await reader.app.close()
})

test('rejects plugin tool calls when the manifest permission is missing', async () => {
  await writePlugin({
    id: 'reader-bai.view-denied',
    name: 'Denied Demo',
    title: '受限面板',
    appJs: executeToolScript
  })

  const reader = await launchReader(userDataDir)
  await reader.page.getByRole('button', { name: 'Denied Demo · 受限面板' }).click()

  const frame = reader.page.frameLocator('iframe[title="Denied Demo · 受限面板"]')
  await expect(frame.locator('#tools')).toContainText('error:插件缺少权限：documents:read')

  await reader.app.close()
})
