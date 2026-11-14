import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import {
  createUserDataDir,
  launchReader,
  readJsonFile,
  removeUserDataDir,
  seedLibrary,
  stubMessageBox
} from './helpers'

interface ToolInfo {
  name: string
  risk: string
  exposeToAi: boolean
}

interface ToolResult {
  content: string
}

interface ToolApi {
  listTools: () => Promise<ToolInfo[]>
  executeTool: (name: string, input: unknown) => Promise<ToolResult>
}

const paperPath = (userDataDir: string): string => join(userDataDir, 'attention.pdf')

const listTools = (page: Page): Promise<ToolInfo[]> =>
  page.evaluate(async () => {
    const api = (globalThis as unknown as { api: ToolApi }).api
    return api.listTools()
  })

const executeTool = (page: Page, name: string, input: unknown): Promise<ToolResult> =>
  page.evaluate(
    async ({ toolName, toolInput }) => {
      const api = (globalThis as unknown as { api: ToolApi }).api
      return api.executeTool(toolName, toolInput)
    },
    { toolName: name, toolInput: input }
  )

const executeToolError = (page: Page, name: string, input: unknown): Promise<string | null> =>
  page.evaluate(
    async ({ toolName, toolInput }) => {
      const api = (globalThis as unknown as { api: ToolApi }).api
      try {
        await api.executeTool(toolName, toolInput)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    { toolName: name, toolInput: input }
  )

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

test('lists platform tools and executes a read-only tool', async () => {
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Attention Is All You Need', path: paperPath(userDataDir) }]
  })
  const { app, page } = await launchReader(userDataDir)

  const tools = await listTools(page)
  expect(tools.map((tool) => tool.name)).toEqual([
    'library.list',
    'paper.get',
    'annotations.list',
    'annotations.add',
    'annotations.remove'
  ])
  expect(tools.every((tool) => tool.exposeToAi)).toBe(true)

  const result = await executeTool(page, 'library.list', { query: 'attention' })
  expect(JSON.parse(result.content)).toMatchObject({
    total: 1,
    papers: [{ id: 'paper-1', title: 'Attention Is All You Need' }]
  })

  await app.close()
})

test('rejects unknown tools and invalid input', async () => {
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Attention Is All You Need', path: paperPath(userDataDir) }]
  })
  const { app, page } = await launchReader(userDataDir)

  expect(await executeToolError(page, 'missing.tool', {})).toContain('工具不存在')
  expect(await executeToolError(page, 'library.list', { limit: 0 })).toContain('参数 limit')

  await app.close()
})

test('does not write annotations when the user declines the confirmation', async () => {
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Attention Is All You Need', path: paperPath(userDataDir) }]
  })
  const { app, page } = await launchReader(userDataDir)
  await stubMessageBox(app, 0)

  const error = await executeToolError(page, 'annotations.add', {
    paperId: 'paper-1',
    page: 1,
    text: 'attention',
    rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.02 }]
  })

  expect(error).toContain('没有权限执行该工具：annotations.add')
  expect(await readJsonFile(join(userDataDir, 'annotations.json'))).toBeNull()

  await app.close()
})

test('writes annotations after the user confirms', async () => {
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Attention Is All You Need', path: paperPath(userDataDir) }]
  })
  const { app, page } = await launchReader(userDataDir)
  await stubMessageBox(app, 1)

  const result = await executeTool(page, 'annotations.add', {
    paperId: 'paper-1',
    page: 1,
    text: 'attention',
    rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.02 }]
  })
  const created = JSON.parse(result.content) as { id: string; color: string }

  expect(created).toMatchObject({ color: '#facc15' })
  expect(created.id).toEqual(expect.any(String))

  const stored = await readJsonFile<Record<string, { id: string }[]>>(
    join(userDataDir, 'annotations.json')
  )
  expect(stored?.[paperPath(userDataDir)]).toEqual([expect.objectContaining({ id: created.id })])

  await app.close()
})
