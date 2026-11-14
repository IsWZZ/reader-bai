import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUserDataDir, launchReader, removeUserDataDir, writeSamplePdf } from './helpers'

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

test('lists a library paper and renders it in the PDF viewer', async () => {
  const pdfPath = join(userDataDir, 'sample.pdf')
  await writeSamplePdf(pdfPath)
  await writeFile(
    join(userDataDir, 'Userdata', 'library.json'),
    JSON.stringify({
      spaces: [],
      papers: [
        {
          id: 'paper-1',
          title: 'Sample Paper',
          path: pdfPath,
          fileName: 'sample.pdf',
          spaceId: null,
          titleSource: 'user',
          createdAt: Date.now()
        }
      ]
    }),
    'utf8'
  )

  const { app, page } = await launchReader(userDataDir)

  await expect(page.getByText('Sample Paper')).toBeVisible()
  await page.getByText('Sample Paper').click()

  const firstPage = page.locator('[data-page="1"]')
  await expect(firstPage.locator('canvas')).toBeVisible()
  await expect(firstPage.locator('.pdf-text-layer')).toContainText(/Hello/)
  await expect(firstPage.locator('.pdf-text-layer')).toContainText(/reader-bai/)

  await app.close()
})

test('creates a space from the library panel', async () => {
  const { app, page } = await launchReader(userDataDir)

  await page.getByRole('button', { name: '新建空间' }).click()
  const nameInput = page.getByPlaceholder('空间名称')
  await nameInput.fill('机器学习')
  await nameInput.press('Enter')

  await expect(page.getByText('机器学习')).toBeVisible()

  const library = JSON.parse(await readFile(join(userDataDir, 'Userdata', 'library.json'), 'utf8'))
  expect(library.spaces).toHaveLength(1)
  expect(library.spaces[0].name).toBe('机器学习')

  await app.close()
})
