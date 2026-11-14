import { expect, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import {
  createUserDataDir,
  launchReader,
  readJsonFile,
  removeUserDataDir,
  seedLibrary,
  stubOpenDialog,
  writeSamplePdf
} from './helpers'

interface StoredMetadata {
  title: string
  authors: string[]
  venue?: string
  year?: number
  doi?: string
  abstract?: string
  keywords: string[]
  summary?: string
  source: string
}

interface StoredPaper {
  id: string
  title: string
  titleSource: string
  metadata?: StoredMetadata
}

interface StoredLibrary {
  papers: StoredPaper[]
}

interface StubServer {
  server: Server
  baseUrl: string
  requests: { messages: { role: string; content: string | null }[] }[]
}

const METADATA = {
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  venue: 'NeurIPS',
  venueType: 'conference',
  year: 2017,
  doi: '10.1234/e2e.2024',
  abstract: 'An abstract parsed from the paper.',
  keywords: ['transformer', 'attention'],
  summary: 'A short AI summary.'
}

let userDataDir: string
let stub: StubServer

const startMetadataStub = async (): Promise<StubServer> => {
  const requests: StubServer['requests'] = []
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
      const body = JSON.parse(raw) as StubServer['requests'][number]
      requests.push(body)

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache'
      })
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { content: JSON.stringify(METADATA) } }]
        })}\n\n`
      )
      res.end('data: [DONE]\n\n')
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    server,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests
  }
}

const closeStubServer = async (target: StubServer): Promise<void> => {
  target.server.closeAllConnections()
  await new Promise<void>((resolve) => target.server.close(() => resolve()))
}

const settingsFile = (): string => join(userDataDir, 'Userdata', 'settings.json')
const libraryFile = (): string => join(userDataDir, 'Userdata', 'library.json')

const seedSettings = async (autoAnalyze: boolean): Promise<void> => {
  await writeFile(
    settingsFile(),
    JSON.stringify(
      {
        theme: 'light',
        language: 'zh',
        ai: {
          profiles: [
            {
              id: 'default',
              baseUrl: stub.baseUrl,
              model: 'stub-model',
              apiKey: 'sk-e2e-test',
              apiKeyEncrypted: false,
              enabled: true
            }
          ],
          activeId: 'default'
        },
        library: { autoAnalyze }
      },
      null,
      2
    ),
    'utf8'
  )
}

/** 拦截 Crossref，避免 E2E 访问真实网络；AI 请求仍走本地桩服务 */
const stubCrossref = async (
  app: Awaited<ReturnType<typeof launchReader>>['app']
): Promise<void> => {
  await app.evaluate(() => {
    const original = globalThis.fetch
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.startsWith('https://api.crossref.org')) {
        return Promise.resolve(new Response('{}', { status: 404 }))
      }
      return original(input, init)
    }) as typeof globalThis.fetch
  })
}

test.beforeAll(async () => {
  stub = await startMetadataStub()
})

test.afterAll(async () => {
  await closeStubServer(stub)
})

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
  stub.requests.length = 0
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

test('opens AI settings when analysis is requested without a configured profile', async () => {
  const pdfPath = join(userDataDir, 'sample.pdf')
  await writeSamplePdf(pdfPath)
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Sample Paper', path: pdfPath, titleSource: 'user' }]
  })

  const reader = await launchReader(userDataDir)
  await reader.page.getByRole('button', { name: 'Sample Paper 操作' }).click()
  await reader.page.getByRole('menuitem', { name: 'AI 解析论文信息' }).click()

  const dialog = reader.page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('还没有配置，点击「新增模型」开始。')

  await reader.app.close()
})

test('analyzes an imported paper and stores its metadata', async () => {
  const pdfPath = join(userDataDir, 'sample.pdf')
  await writeSamplePdf(pdfPath)
  await seedSettings(true)

  const reader = await launchReader(userDataDir)
  await stubCrossref(reader.app)
  await stubOpenDialog(reader.app, pdfPath)

  await reader.page.getByRole('button', { name: '导入论文' }).click()

  await expect(reader.page.getByText('Attention Is All You Need', { exact: true })).toBeVisible()
  await expect(reader.page.getByText('Ashish Vaswani, Noam Shazeer')).toBeVisible()
  await expect(reader.page.getByText('NeurIPS · 2017')).toBeVisible()

  await expect
    .poll(async () => (await readJsonFile<StoredLibrary>(libraryFile()))?.papers[0]?.metadata)
    .toMatchObject({
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      venue: 'NeurIPS',
      year: 2017,
      doi: '10.1234/e2e.2024',
      source: 'ai'
    })
  await expect
    .poll(async () => (await readJsonFile<StoredLibrary>(libraryFile()))?.papers[0]?.titleSource)
    .toBe('metadata')

  // 只把 PDF 前几页文本发给模型，并明确要求结构化 JSON
  expect(stub.requests).toHaveLength(1)
  expect(stub.requests[0].messages[0].content).toContain('one JSON object')
  expect(stub.requests[0].messages[1].content).toContain('Hello reader-bai')

  // 详情弹窗展示解析出的书目信息
  await reader.page.getByRole('button', { name: 'Attention Is All You Need 操作' }).click()
  await reader.page.getByRole('menuitem', { name: '查看论文信息' }).click()
  await expect(reader.page.getByText('10.1234/e2e.2024')).toBeVisible()
  await expect(reader.page.getByText('An abstract parsed from the paper.')).toBeVisible()
  await expect(reader.page.getByText('A short AI summary.')).toBeVisible()

  await reader.app.close()
})

test('skips automatic analysis when the setting is off', async () => {
  const pdfPath = join(userDataDir, 'sample.pdf')
  await writeSamplePdf(pdfPath)
  await seedSettings(false)

  const reader = await launchReader(userDataDir)
  await stubCrossref(reader.app)
  await stubOpenDialog(reader.app, pdfPath)

  await reader.page.getByRole('button', { name: '导入论文' }).click()
  await expect(reader.page.getByRole('button', { name: 'sample', exact: true })).toBeVisible()

  // 给异步解析留出时间，确认没有发起请求
  await reader.page.waitForTimeout(500)
  expect(stub.requests).toHaveLength(0)
  expect((await readJsonFile<StoredLibrary>(libraryFile()))?.papers[0]?.metadata).toBeUndefined()

  await reader.app.close()
})
