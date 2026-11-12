import { expect, test } from '@playwright/test'
import { access } from 'node:fs/promises'
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

interface StoredPaper {
  id: string
  title: string
  path: string
  spaceId: string | null
  titleSource: string
}

interface StoredLibrary {
  spaces: { id: string; name: string }[]
  papers: StoredPaper[]
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

test('imports a PDF and backfills the metadata title', async () => {
  const pdfPath = join(userDataDir, 'sample.pdf')
  await writeSamplePdf(pdfPath, 'Metadata Title')

  const reader = await launchReader(userDataDir)
  await stubOpenDialog(reader.app, pdfPath)

  await reader.page.getByRole('button', { name: '导入论文' }).click()

  // 初始名是文件名，渲染进程解析 PDF 元数据后替换为真实标题
  await expect(
    reader.page.getByRole('button', { name: 'Metadata Title', exact: true })
  ).toBeVisible()
  await expect.poll(async () => (await readLibrary())?.papers[0]?.titleSource).toBe('metadata')
  expect((await readLibrary())?.papers[0]).toMatchObject({
    title: 'Metadata Title',
    path: pdfPath,
    spaceId: null
  })

  await reader.app.close()
})

test('importing the same file twice does not duplicate it', async () => {
  const pdfPath = join(userDataDir, 'sample.pdf')
  await writeSamplePdf(pdfPath, 'Metadata Title')

  const reader = await launchReader(userDataDir)
  await stubOpenDialog(reader.app, pdfPath)

  const importButton = reader.page.getByRole('button', { name: '导入论文' })
  await importButton.click()
  await expect(
    reader.page.getByRole('button', { name: 'Metadata Title', exact: true })
  ).toBeVisible()
  await importButton.click()

  await expect.poll(async () => (await readLibrary())?.papers.length).toBe(1)
  await expect(
    reader.page.getByRole('button', { name: 'Metadata Title', exact: true })
  ).toHaveCount(1)

  await reader.app.close()
})

test('cancelling the file dialog leaves the library untouched', async () => {
  const reader = await launchReader(userDataDir)
  await stubOpenDialog(reader.app, null)

  await reader.page.getByRole('button', { name: '导入论文' }).click()

  await expect(reader.page.getByText('暂无论文')).toBeVisible()
  expect(await readLibrary()).toBeNull()

  await reader.app.close()
})

test('imports a paper directly into the requested space', async () => {
  const pdfPath = join(userDataDir, 'sample.pdf')
  await writeSamplePdf(pdfPath)
  await seedLibrary(userDataDir, {
    spaces: [{ id: 'space-ml', name: '机器学习' }],
    papers: []
  })

  const reader = await launchReader(userDataDir)
  await stubOpenDialog(reader.app, pdfPath)

  await reader.page.getByRole('button', { name: '导入到机器学习' }).click()

  await expect(reader.page.getByRole('button', { name: 'sample', exact: true })).toBeVisible()
  await expect.poll(async () => (await readLibrary())?.papers[0]?.spaceId).toBe('space-ml')
  await expect(access(pdfPath)).resolves.toBeUndefined()

  await reader.app.close()
})
