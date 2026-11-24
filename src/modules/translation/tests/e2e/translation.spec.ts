import { expect, test, type Locator, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import {
  createUserDataDir,
  launchReader,
  openPaper,
  readJsonFile,
  removeUserDataDir,
  seedLibrary,
  writeSamplePdf
} from '../../../../../tests/e2e/helpers'

interface StoredAiProfile {
  id: string
  baseUrl: string
  apiKey: string
  apiKeyEncrypted: boolean
  model: string
  enabled: boolean
}

interface StoredSettings {
  theme: string
  ai: {
    profiles?: StoredAiProfile[]
    activeId?: string
    baseUrl?: string
    apiKey?: string
    apiKeyEncrypted?: boolean
    model?: string
  }
}

interface StubRequest {
  model: string
  stream: boolean
  messages: { role: string; content: string | null }[]
}

interface CapturedRequest {
  server: string
  body: StubRequest
  authorization: string | undefined
}

interface StubServer {
  server: Server
  baseUrl: string
}

let userDataDir: string
let primary: StubServer
let secondary: StubServer
const captured: CapturedRequest[] = []

const startStubServer = async (name: string, translation: string): Promise<StubServer> => {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }

    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      const body = JSON.parse(raw) as StubRequest
      captured.push({ server: name, body, authorization: req.headers.authorization })

      const parts = [translation.slice(0, 2), translation.slice(2)]

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      res.flushHeaders()

      let index = 0
      const timer = setInterval(() => {
        if (index < parts.length) {
          const delta = parts[index]
          index += 1
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
        } else {
          clearInterval(timer)
          res.end('data: [DONE]\n\n')
        }
      }, 20)
      res.on('close', () => clearInterval(timer))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  return { server, baseUrl }
}

const closeStubServer = async (stub: StubServer): Promise<void> => {
  stub.server.closeAllConnections()
  await new Promise<void>((resolve) => stub.server.close(() => resolve()))
}

test.beforeAll(async () => {
  primary = await startStubServer('primary', '这是译文')
  secondary = await startStubServer('secondary', '第二配置译文')
})

test.afterAll(async () => {
  await closeStubServer(primary)
  await closeStubServer(secondary)
})

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
  captured.length = 0
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

const settingsFile = (): string => join(userDataDir, 'Userdata', 'settings.json')

const seedAiProfiles = async (profiles: StoredAiProfile[], activeId: string): Promise<void> => {
  await writeFile(
    settingsFile(),
    JSON.stringify({ theme: 'light', ai: { profiles, activeId } }, null, 2),
    'utf8'
  )
}

const seedSingleProfile = (url: string, model = 'stub-model'): Promise<void> =>
  seedAiProfiles(
    [
      {
        id: 'default',
        baseUrl: url,
        model,
        apiKey: 'sk-e2e-test',
        apiKeyEncrypted: false,
        enabled: true
      }
    ],
    'default'
  )

const seedPaper = async (): Promise<void> => {
  const pdfPath = join(userDataDir, 'sample.pdf')
  await writeSamplePdf(pdfPath)
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Sample Paper', path: pdfPath, titleSource: 'user' }]
  })
}

/** 单击文字层里的某个单词，触发阅读器的选词与翻译。 */
const clickWord = async (page: Page, firstPage: Locator, word: string): Promise<void> => {
  const span = firstPage.locator('.pdf-text-layer span').filter({ hasText: word }).first()
  await expect(span).toBeVisible()
  const box = await span.boundingBox()
  if (!box) throw new Error(`未找到 “${word}” 的文字层位置`)
  await page.mouse.click(box.x + 6, box.y + box.height / 2)
}

const translationToggle = (page: Page): Locator =>
  page.getByRole('button', { name: '翻译', exact: true })

const openTranslation = async (page: Page): Promise<Locator> => {
  const toggle = translationToggle(page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const panel = page.locator('aside[aria-label="翻译面板"]')
  await expect(panel).toBeVisible()
  return panel
}

const modelSelect = (panel: Locator): Locator => panel.getByRole('combobox', { name: '选择模型' })

test('opens AI settings when translation is used without a configured profile', async () => {
  const reader = await launchReader(userDataDir)

  await reader.page.getByRole('button', { name: '翻译', exact: true }).click()

  const dialog = reader.page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '新增模型' })).toBeVisible()
  expect(await reader.page.locator('aside[aria-label="翻译面板"]').count()).toBe(0)

  await reader.app.close()
})

test('translates the selected word and streams the result into the panel', async () => {
  await seedPaper()
  await seedSingleProfile(primary.baseUrl)
  const reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Sample Paper')
  const panel = await openTranslation(reader.page)

  const firstPage = reader.page.locator('[data-page="1"]')
  await clickWord(reader.page, firstPage, 'Hello')

  await expect(panel).toContainText('这是译文', { timeout: 10_000 })
  expect(captured).toHaveLength(1)
  expect(captured[0].server).toBe('primary')
  expect(captured[0].body.model).toBe('stub-model')
  expect(captured[0].body.stream).toBe(true)
  expect(captured[0].authorization).toBe('Bearer sk-e2e-test')
  expect(captured[0].body.messages[0]?.content).toContain('翻译')
  expect(captured[0].body.messages[1]).toEqual({ role: 'user', content: 'Hello' })

  // 再点一次活动栏按钮即可关闭面板；进程常驻由 runtime 单元测试覆盖
  await translationToggle(reader.page).click()
  await expect(reader.page.locator('aside[aria-label="翻译面板"]')).toHaveCount(0)

  await reader.app.close()
})

test('switches the model from the panel dropdown and remembers it after relaunch', async () => {
  await seedPaper()
  await seedAiProfiles(
    [
      {
        id: 'a',
        baseUrl: primary.baseUrl,
        model: 'model-a',
        apiKey: 'sk-a',
        apiKeyEncrypted: false,
        enabled: true
      },
      {
        id: 'b',
        baseUrl: secondary.baseUrl,
        model: 'model-b',
        apiKey: 'sk-b',
        apiKeyEncrypted: false,
        enabled: true
      }
    ],
    'a'
  )

  let reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Sample Paper')
  let panel = await openTranslation(reader.page)

  const select = modelSelect(panel)
  await select.click()
  const options = reader.page.getByRole('option')
  await expect(options).toHaveCount(2)
  await expect(options).toHaveText(['model-a', 'model-b'])
  await reader.page.getByRole('option', { name: 'model-b', exact: true }).click()

  // 等下拉关闭动画结束，避免退场层挡住接下来在阅读区的点击
  await expect(reader.page.getByRole('option')).toHaveCount(0)
  await expect(modelSelect(panel)).toHaveText('model-b')
  await expect
    .poll(async () => (await readJsonFile<StoredSettings>(settingsFile()))?.ai.activeId)
    .toBe('b')

  await clickWord(reader.page, reader.page.locator('[data-page="1"]'), 'Hello')

  await expect(panel).toContainText('第二配置译文', { timeout: 10_000 })
  expect(captured).toHaveLength(1)
  expect(captured[0].server).toBe('secondary')
  expect(captured[0].body.model).toBe('model-b')
  expect(captured[0].authorization).toBe('Bearer sk-b')
  await reader.app.close()

  // 重启后下拉仍选中切换过的配置
  reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Sample Paper')
  panel = await openTranslation(reader.page)
  await expect(modelSelect(panel)).toHaveText('model-b')
  await reader.app.close()
})

test('shows a readable error when the AI service is unreachable', async () => {
  const dead = createServer()
  await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve))
  const deadPort = (dead.address() as AddressInfo).port
  await new Promise<void>((resolve) => dead.close(() => resolve()))

  await seedPaper()
  await seedSingleProfile(`http://127.0.0.1:${deadPort}/v1`)
  const reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Sample Paper')
  const panel = await openTranslation(reader.page)

  await clickWord(reader.page, reader.page.locator('[data-page="1"]'), 'Hello')

  await expect(panel).toContainText('无法连接到 AI 服务', { timeout: 10_000 })
  await reader.app.close()
})
