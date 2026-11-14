import { expect, test, type Page } from '@playwright/test'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createUserDataDir,
  launchReader,
  readJsonFile,
  removeUserDataDir,
  seedLibrary,
  writeSamplePdf
} from './helpers'

interface StoredPaper {
  id: string
  title: string
  path: string
  fileName: string
  spaceId: string | null
  titleSource: string
}

interface StoredLibrary {
  spaces: { id: string; name: string }[]
  papers: StoredPaper[]
}

interface TestApi {
  createSpace: (name: string) => Promise<unknown>
  renameSpace: (id: string, name: string) => Promise<unknown>
  renamePaper: (id: string, title: string, source?: 'metadata' | 'user') => Promise<unknown>
  movePaper: (id: string, spaceId: string | null) => Promise<unknown>
  removePaper: (id: string) => Promise<unknown>
  readPaper: (path: string) => Promise<unknown>
  listAnnotations: (path: string) => Promise<unknown>
  addAnnotation: (path: string, annotation: unknown) => Promise<unknown>
  removeAnnotations: (path: string, ids: string[]) => Promise<unknown>
}

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

const libraryFile = (): string => join(userDataDir, 'library.json')
const readLibrary = (): Promise<StoredLibrary | null> => readJsonFile<StoredLibrary>(libraryFile())

const createPaperPdf = async (name = 'paper.pdf'): Promise<string> => {
  const path = join(userDataDir, name)
  await writeSamplePdf(path)
  return path
}

/** 在渲染进程里调用 window.api，收集失败信息（IPC 错误会带上主进程的原始消息）。 */
const collectApiFailures = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const api = (globalThis as unknown as { api: TestApi }).api
    const calls: (() => Promise<unknown>)[] = [
      () => api.createSpace('   '),
      () => api.createSpace('x'.repeat(100)),
      () => api.renameSpace('missing-space', '名称'),
      () => api.renamePaper('missing-paper', '名称'),
      () => api.movePaper('paper-1', 'missing-space'),
      () => api.readPaper('/tmp/not-in-library.pdf'),
      () =>
        api.addAnnotation('/tmp/not-in-library.pdf', {
          id: 'a-1',
          type: 'highlight',
          color: '#facc15',
          page: 1,
          rects: [],
          text: 'x',
          createdAt: Date.now()
        }),
      () => api.removeAnnotations('/tmp/not-in-library.pdf', ['a-1'])
    ]
    const messages: string[] = []
    for (const call of calls) {
      try {
        await call()
        messages.push('')
      } catch (error) {
        messages.push(String(error))
      }
    }
    return messages
  })

test('renames a paper inline and persists the user title', async () => {
  const pdfPath = await createPaperPdf()
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Old Title', path: pdfPath, titleSource: 'user' }]
  })

  const reader = await launchReader(userDataDir)
  await reader.page.getByRole('button', { name: 'Old Title', exact: true }).dblclick()

  const input = reader.page.locator('input[data-inline-input]')
  await expect(input).toBeVisible()
  await input.fill('New Title')
  await input.press('Enter')

  await expect(reader.page.getByRole('button', { name: 'New Title', exact: true })).toBeVisible()
  await expect.poll(async () => (await readLibrary())?.papers[0]?.title).toBe('New Title')
  expect((await readLibrary())?.papers[0]?.titleSource).toBe('user')

  await reader.app.close()
})

test('metadata backfill never overwrites a user rename', async () => {
  const pdfPath = await createPaperPdf()
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'User Title', path: pdfPath, titleSource: 'user' }]
  })

  const reader = await launchReader(userDataDir)
  await reader.page.evaluate(async () => {
    const api = (globalThis as unknown as { api: TestApi }).api
    await api.renamePaper('paper-1', 'Metadata Title', 'metadata')
  })

  await expect.poll(async () => (await readLibrary())?.papers[0]?.title).toBe('User Title')
  expect((await readLibrary())?.papers[0]?.titleSource).toBe('user')

  await reader.app.close()
})

test('moves a paper into a space from the context menu', async () => {
  const pdfPath = await createPaperPdf()
  await seedLibrary(userDataDir, {
    spaces: [{ id: 'space-ml', name: '机器学习' }],
    papers: [{ id: 'paper-1', title: 'Paper A', path: pdfPath, titleSource: 'user' }]
  })

  const reader = await launchReader(userDataDir)
  await reader.page.getByRole('button', { name: 'Paper A', exact: true }).hover()
  await reader.page.getByRole('button', { name: 'Paper A 操作' }).click()
  await reader.page.getByRole('menuitem', { name: '机器学习' }).click()

  await expect.poll(async () => (await readLibrary())?.papers[0]?.spaceId).toBe('space-ml')
  await expect(reader.page.getByRole('button', { name: 'Paper A', exact: true })).toBeVisible()

  await reader.app.close()
})

test('renames a space from the context menu', async () => {
  await seedLibrary(userDataDir, {
    spaces: [{ id: 'space-1', name: '机器学习' }],
    papers: []
  })

  const reader = await launchReader(userDataDir)
  await reader.page.getByText('机器学习', { exact: true }).hover()
  await reader.page.getByRole('button', { name: '机器学习 操作' }).click()
  await reader.page.getByRole('menuitem', { name: '重命名空间' }).click()

  const input = reader.page.locator('input[data-inline-input]')
  await expect(input).toBeVisible()
  await input.fill('深度学习')
  await input.press('Enter')

  await expect(reader.page.getByText('深度学习', { exact: true })).toBeVisible()
  await expect.poll(async () => (await readLibrary())?.spaces[0]?.name).toBe('深度学习')

  await reader.app.close()
})

test('deleting a space moves its papers to uncategorized without deleting files', async () => {
  const pdfPath = await createPaperPdf()
  await seedLibrary(userDataDir, {
    spaces: [{ id: 'space-1', name: '机器学习' }],
    papers: [
      { id: 'paper-1', title: 'Paper A', path: pdfPath, spaceId: 'space-1', titleSource: 'user' }
    ]
  })

  const reader = await launchReader(userDataDir)
  await reader.page.getByText('机器学习', { exact: true }).hover()
  await reader.page.getByRole('button', { name: '机器学习 操作' }).click()
  await reader.page.getByRole('menuitem', { name: '删除空间' }).click()

  await expect(reader.page.getByText('未分类', { exact: true })).toBeVisible()
  await expect(reader.page.getByRole('button', { name: 'Paper A', exact: true })).toBeVisible()
  await expect.poll(async () => (await readLibrary())?.spaces.length).toBe(0)
  expect((await readLibrary())?.papers[0]?.spaceId).toBeNull()
  await expect(access(pdfPath)).resolves.toBeUndefined()

  await reader.app.close()
})

test('removing a paper only removes the library entry', async () => {
  const pdfPath = await createPaperPdf()
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Paper A', path: pdfPath, titleSource: 'user' }]
  })

  const reader = await launchReader(userDataDir)
  await reader.page.getByRole('button', { name: 'Paper A', exact: true }).hover()
  await reader.page.getByRole('button', { name: 'Paper A 操作' }).click()
  await reader.page.getByRole('menuitem', { name: '从论文库移除' }).click()

  await expect(reader.page.getByText('暂无论文')).toBeVisible()
  await expect.poll(async () => (await readLibrary())?.papers.length).toBe(0)
  await expect(access(pdfPath)).resolves.toBeUndefined()

  await reader.app.close()
})

test('rejects invalid library operations', async () => {
  const pdfPath = await createPaperPdf()
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Paper A', path: pdfPath, titleSource: 'user' }]
  })

  const reader = await launchReader(userDataDir)
  const [emptySpace, longSpace, missingSpace, missingPaper, missingMove, unreadable, add, remove] =
    await collectApiFailures(reader.page)

  expect(emptySpace).toContain('空间名称不能为空')
  expect(longSpace).toBe('')
  expect(missingSpace).toContain('空间不存在')
  expect(missingPaper).toContain('论文不存在')
  expect(missingMove).toContain('空间不存在')
  expect(unreadable).toContain('Paper not found in library')
  expect(add).toContain('Paper not found in library')
  expect(remove).toContain('Paper not found in library')

  // 读取注释与写入一样校验论文库归属
  const listError = await reader.page.evaluate(async () => {
    const api = (globalThis as unknown as { api: TestApi }).api
    try {
      await api.listAnnotations('/tmp/not-in-library.pdf')
      return ''
    } catch (error) {
      return String(error)
    }
  })
  expect(listError).toContain('Paper not found in library')
  // 超长空间名会被截断到 60 个字符
  expect((await readLibrary())?.spaces[0]?.name).toHaveLength(60)

  await reader.app.close()
})

test('migrates the legacy array-only library on the next write', async () => {
  const pdfPath = join(userDataDir, 'legacy-sample.pdf')
  await writeSamplePdf(pdfPath)
  // 旧版本只存一个论文数组
  await writeFile(libraryFile(), JSON.stringify([{ path: pdfPath }]), 'utf8')

  const reader = await launchReader(userDataDir)
  await expect(
    reader.page.getByRole('button', { name: 'legacy-sample', exact: true })
  ).toBeVisible()

  await reader.page.getByRole('button', { name: '新建空间' }).click()
  const input = reader.page.getByPlaceholder('空间名称')
  await input.fill('Legacy Space')
  await input.press('Enter')

  await expect.poll(async () => (await readLibrary())?.papers[0]?.id).toBeTruthy()
  const library = await readLibrary()
  expect(library?.spaces).toHaveLength(1)
  expect(library?.papers[0]).toMatchObject({
    title: 'legacy-sample',
    fileName: 'legacy-sample.pdf',
    path: pdfPath,
    spaceId: null,
    titleSource: 'file'
  })

  await reader.app.close()
})
