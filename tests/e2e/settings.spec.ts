import { expect, test, type Locator } from '@playwright/test'
import { join } from 'node:path'
import {
  createUserDataDir,
  launchReader,
  readJsonFile,
  removeUserDataDir,
  type ReaderInstance
} from './helpers'

interface StoredSettings {
  theme: string
  ai: { baseUrl: string; apiKey: string; apiKeyEncrypted: boolean }
}

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

const settingsFile = (): string => join(userDataDir, 'settings.json')

const openSettings = async (page: ReaderInstance['page']): Promise<Locator> => {
  await page.getByRole('button', { name: '设置' }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('applies the selected theme and restores it after relaunch', async () => {
  let reader = await launchReader(userDataDir)
  const dialog = await openSettings(reader.page)

  await dialog.getByRole('button', { name: '深色' }).click()
  await expect(reader.page.locator('html')).toHaveClass(/dark/)
  await expect
    .poll(async () => (await readJsonFile<StoredSettings>(settingsFile()))?.theme)
    .toBe('dark')

  await reader.app.close()

  reader = await launchReader(userDataDir)
  await expect(reader.page.locator('html')).toHaveClass(/dark/)
  await reader.app.close()
})

test('saves AI settings, encrypting the API key when available', async () => {
  let reader = await launchReader(userDataDir)
  let dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()

  await dialog.locator('#ai-base-url').fill('https://api.example.com/v1/')
  await dialog.locator('#ai-api-key').fill('sk-e2e-secret')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog.getByText('已保存')).toBeVisible()

  await expect
    .poll(async () => (await readJsonFile<StoredSettings>(settingsFile()))?.ai.baseUrl)
    .toBe('https://api.example.com/v1')

  const stored = await readJsonFile<StoredSettings>(settingsFile())
  expect(stored).not.toBeNull()
  const encryptionAvailable = await reader.app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable()
  )
  if (encryptionAvailable) {
    expect(stored?.ai.apiKeyEncrypted).toBe(true)
    expect(stored?.ai.apiKey).not.toBe('sk-e2e-secret')
  }
  await reader.app.close()

  // 重启后配置应能回填到表单
  reader = await launchReader(userDataDir)
  dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()
  await expect(dialog.locator('#ai-base-url')).toHaveValue('https://api.example.com/v1')
  await expect(dialog.locator('#ai-api-key')).toHaveValue('sk-e2e-secret')
  await reader.app.close()
})

test('rejects an invalid Base URL', async () => {
  const reader = await launchReader(userDataDir)
  const dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()

  await dialog.locator('#ai-base-url').fill('ftp://example.com')
  await dialog.getByRole('button', { name: '保存' }).click()

  await expect(dialog.getByText('Base URL 需要是以 http:// 或 https:// 开头的地址')).toBeVisible()
  await expect.poll(async () => readJsonFile<StoredSettings>(settingsFile())).toBeNull()
  await reader.app.close()
})
