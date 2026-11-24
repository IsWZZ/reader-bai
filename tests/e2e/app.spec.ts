import { expect, test } from '@playwright/test'
import { createUserDataDir, launchReader, removeUserDataDir } from './helpers'

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

test('starts with the library open and no papers', async () => {
  const { app, page } = await launchReader(userDataDir)

  await expect(page.getByRole('heading', { name: '论文库' })).toBeVisible()
  await expect(page.getByText('暂无论文')).toBeVisible()
  // 没有打开论文时不显示阅读区
  await expect(page.locator('main')).toHaveCount(0)

  await app.close()
})

test('opens and closes the settings dialog', async () => {
  const { app, page } = await launchReader(userDataDir)

  await page.getByRole('button', { name: '设置' }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toBeHidden()

  await app.close()
})
