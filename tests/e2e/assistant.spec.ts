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
} from './helpers'

interface StoredAiProfile {
  id: string
  baseUrl: string
  apiKey: string
  apiKeyEncrypted: boolean
  model: string
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
  messages: { role: string; content: string | null; tool_call_id?: string }[]
  tools?: { type: string; function: { name: string } }[]
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
let agent: StubServer
const captured: CapturedRequest[] = []

const startStubServer = async (
  name: string,
  translation: string,
  chatReply: string
): Promise<StubServer> => {
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

      const isTranslation = body.messages[0]?.content?.includes('翻译') ?? false
      const text = isTranslation ? translation : chatReply
      const parts = [text.slice(0, 2), text.slice(2)]

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

/** 第一次对话返回 library.list 工具调用，第二次返回最终回答 */
const startAgentStubServer = async (): Promise<StubServer> => {
  let chatRequests = 0
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
      captured.push({ server: 'agent', body, authorization: req.headers.authorization })

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      res.flushHeaders()

      if (chatRequests === 0) {
        chatRequests += 1
        res.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      type: 'function',
                      function: { name: 'library.list', arguments: '{}' }
                    }
                  ]
                }
              }
            ]
          })}\n\n`
        )
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`
        )
        res.end('data: [DONE]\n\n')
        return
      }

      const text = '论文库里有一篇论文'
      const parts = [text.slice(0, 3), text.slice(3)]
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

test.beforeAll(async () => {
  primary = await startStubServer('primary', '这是译文', '你好，我是助手')
  secondary = await startStubServer('secondary', '第二配置译文', '来自第二个模型')
  agent = await startAgentStubServer()
})

test.afterAll(async () => {
  await closeStubServer(primary)
  await closeStubServer(secondary)
  await closeStubServer(agent)
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
    [{ id: 'default', baseUrl: url, model, apiKey: 'sk-e2e-test', apiKeyEncrypted: false }],
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

const assistantToggle = (page: Page): Locator =>
  page.getByRole('button', { name: '辅助面板', exact: true })

const openAssistant = async (page: Page): Promise<Locator> => {
  const toggle = assistantToggle(page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const panel = page.locator('aside[aria-label="辅助面板"]')
  await expect(panel).toBeVisible()
  return panel
}

const modelSelect = (panel: Locator): Locator => panel.getByRole('combobox', { name: '选择模型' })

test('translates the selected word and streams the result into the panel', async () => {
  await seedPaper()
  await seedSingleProfile(primary.baseUrl)
  const reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Sample Paper')
  const panel = await openAssistant(reader.page)

  const firstPage = reader.page.locator('[data-page="1"]')
  await clickWord(reader.page, firstPage, 'Hello')

  await expect(panel).toContainText('这是译文', { timeout: 10_000 })
  expect(captured).toHaveLength(1)
  expect(captured[0].server).toBe('primary')
  expect(captured[0].body.model).toBe('stub-model')
  expect(captured[0].body.stream).toBe(true)
  expect(captured[0].authorization).toBe('Bearer sk-e2e-test')

  // 再点一次活动栏按钮即可关闭面板
  await assistantToggle(reader.page).click()
  await expect(reader.page.locator('aside[aria-label="辅助面板"]')).toHaveCount(0)

  await reader.app.close()
})

test('streams a chat reply in the assistant panel', async () => {
  await seedPaper()
  await seedSingleProfile(primary.baseUrl)
  const reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Sample Paper')
  const panel = await openAssistant(reader.page)

  await panel.getByRole('textbox', { name: '向 AI 提问' }).fill('你好')
  await panel.getByRole('button', { name: '发送' }).click()

  await expect(panel).toContainText('你好，我是助手', { timeout: 10_000 })
  expect(captured).toHaveLength(1)
  const contents = captured[0].body.messages.map((message) => message.content)
  expect(contents).toContain('你好')
  expect(captured[0].body.model).toBe('stub-model')

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
        apiKeyEncrypted: false
      },
      {
        id: 'b',
        baseUrl: secondary.baseUrl,
        model: 'model-b',
        apiKey: 'sk-b',
        apiKeyEncrypted: false
      }
    ],
    'a'
  )

  let reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Sample Paper')
  let panel = await openAssistant(reader.page)

  const select = modelSelect(panel)
  await expect(select.locator('option')).toHaveCount(2)
  await expect(select.locator('option')).toHaveText(['model-a', 'model-b'])
  await select.selectOption('b')

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
  panel = await openAssistant(reader.page)
  await expect(modelSelect(panel)).toHaveValue('b')
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
  const panel = await openAssistant(reader.page)

  await clickWord(reader.page, reader.page.locator('[data-page="1"]'), 'Hello')

  await expect(panel).toContainText('无法连接到 AI 服务', { timeout: 10_000 })
  await reader.app.close()
})

test('uses read-only platform tools through the agent loop', async () => {
  await seedPaper()
  await seedSingleProfile(agent.baseUrl)
  const reader = await launchReader(userDataDir)
  const panel = await openAssistant(reader.page)

  await panel.getByRole('checkbox', { name: '使用工具' }).check()
  await panel.getByRole('textbox', { name: '向 AI 提问' }).fill('论文库里有哪篇论文？')
  await panel.getByRole('button', { name: '发送' }).click()

  await expect(panel.getByText('论文库里有一篇论文')).toBeVisible({ timeout: 10_000 })
  await expect(panel.getByText('调用工具：library.list')).toBeVisible()

  const requests = captured.filter((item) => item.server === 'agent')
  expect(requests).toHaveLength(2)
  // 只发送平台判定为只读且对 AI 开放的工具
  expect(requests[0].body.tools?.map((tool) => tool.function.name)).toEqual([
    'library.list',
    'paper.get',
    'paper.readPage',
    'annotations.list'
  ])
  const toolMessage = requests[1].body.messages.find((message) => message.role === 'tool')
  expect(toolMessage?.content).toContain('paper-1')

  await reader.app.close()
})
