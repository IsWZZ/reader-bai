import { expect, test, type Locator } from '@playwright/test'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createUserDataDir,
  launchReader,
  readJsonFile,
  removeUserDataDir,
  stubOpenDialog,
  stubOpenDirectoryDialog,
  writeSamplePdf,
  type ReaderInstance
} from './helpers'

interface StoredLibrary {
  papers: { path: string }[]
}

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
  library?: { directory?: string }
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

  await dialog.getByRole('button', { name: '外观' }).click()
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

test('copies imported PDFs into the configured library directory', async () => {
  const customDirectory = join(userDataDir, 'custom-papers')
  const pdfPath = join(userDataDir, 'sample.pdf')
  await writeSamplePdf(pdfPath)

  const reader = await launchReader(userDataDir)
  // 设置默认打开论文库分区
  const dialog = await openSettings(reader.page)

  // 未配置时显示应用数据目录下的默认位置
  await expect(dialog.locator('#library-directory')).toHaveValue(join(userDataDir, 'papers'))

  await stubOpenDirectoryDialog(reader.app, customDirectory)
  await dialog.getByRole('button', { name: '选择文件夹' }).click()
  await expect(dialog.locator('#library-directory')).toHaveValue(customDirectory)
  await expect
    .poll(async () => (await readJsonFile<StoredSettings>(settingsFile()))?.library?.directory)
    .toBe(customDirectory)

  await dialog.getByRole('button', { name: '关闭' }).click()
  await stubOpenDialog(reader.app, pdfPath)
  await reader.page.getByRole('button', { name: '导入论文' }).click()
  await expect(reader.page.getByRole('button', { name: 'sample', exact: true })).toBeVisible()

  const storedPath = join(customDirectory, 'sample.pdf')
  await expect
    .poll(
      async () =>
        (await readJsonFile<StoredLibrary>(join(userDataDir, 'library.json')))?.papers[0]?.path
    )
    .toBe(storedPath)
  await expect(access(storedPath)).resolves.toBeUndefined()
  // 原文件不受影响
  await expect(access(pdfPath)).resolves.toBeUndefined()
  await reader.app.close()
})

test('saves AI settings, encrypting the API key when available', async () => {
  let reader = await launchReader(userDataDir)
  let dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()
  await dialog.getByRole('button', { name: '新增模型' }).click()

  await dialog.locator('#ai-base-url').fill('https://api.example.com/v1/')
  await dialog.locator('#ai-model').fill('  deepseek-chat  ')
  await dialog.locator('#ai-api-key').fill('sk-e2e-secret')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog.getByText('已保存')).toBeVisible()

  await expect
    .poll(
      async () => (await readJsonFile<StoredSettings>(settingsFile()))?.ai.profiles?.[0].baseUrl
    )
    .toBe('https://api.example.com/v1')
  await expect
    .poll(async () => (await readJsonFile<StoredSettings>(settingsFile()))?.ai.profiles?.[0].model)
    .toBe('deepseek-chat')

  const stored = await readJsonFile<StoredSettings>(settingsFile())
  expect(stored).not.toBeNull()
  const profile = stored?.ai.profiles?.[0]
  expect(profile).toBeDefined()
  expect(stored?.ai.activeId).toBe(profile?.id)

  const encryptionAvailable = await reader.app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable()
  )
  if (encryptionAvailable) {
    expect(profile?.apiKeyEncrypted).toBe(true)
    expect(profile?.apiKey).not.toBe('sk-e2e-secret')
  }
  await reader.app.close()

  // 重启后看板里能看到保存的配置，点编辑可回填表单
  reader = await launchReader(userDataDir)
  dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()
  await expect(dialog.getByText('deepseek-chat · api.example.com')).toBeVisible()
  await expect(dialog.getByText('使用中')).toBeVisible()
  await dialog.getByRole('button', { name: '编辑' }).click()
  await expect(dialog.locator('#ai-base-url')).toHaveValue('https://api.example.com/v1')
  await expect(dialog.locator('#ai-model')).toHaveValue('deepseek-chat')
  await expect(dialog.locator('#ai-api-key')).toHaveValue('sk-e2e-secret')
  await reader.app.close()
})

test('stores multiple AI profiles without losing the active one', async () => {
  let reader = await launchReader(userDataDir)
  let dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()
  await dialog.getByRole('button', { name: '新增模型' }).click()

  await dialog.locator('#ai-base-url').fill('https://api.example.com/v1')
  await dialog.locator('#ai-model').fill('model-a')
  await dialog.locator('#ai-api-key').fill('sk-a')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog.getByText('已保存')).toBeVisible()

  await dialog.getByRole('button', { name: '新增模型' }).click()
  await dialog.locator('#ai-base-url').fill('https://api2.example.com/v1')
  await dialog.locator('#ai-model').fill('model-b')
  await dialog.locator('#ai-api-key').fill('sk-b')
  await dialog.getByRole('button', { name: '保存' }).click()

  await expect
    .poll(async () => (await readJsonFile<StoredSettings>(settingsFile()))?.ai.profiles?.length)
    .toBe(2)

  const stored = await readJsonFile<StoredSettings>(settingsFile())
  const profiles = stored?.ai.profiles ?? []
  expect(profiles.map((profile) => profile.model)).toEqual(['model-a', 'model-b'])
  // 第二条只是新增，不改变当前激活的配置
  expect(stored?.ai.activeId).toBe(profiles[0].id)
  await reader.app.close()

  reader = await launchReader(userDataDir)
  dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()

  await expect(dialog.getByText('model-a · api.example.com')).toBeVisible()
  await expect(dialog.getByText('model-b · api2.example.com')).toBeVisible()

  // 第二条也应能重新打开编辑
  await dialog.getByRole('button', { name: '编辑' }).nth(1).click()
  await expect(dialog.locator('#ai-model')).toHaveValue('model-b')
  await expect(dialog.locator('#ai-base-url')).toHaveValue('https://api2.example.com/v1')
  await reader.app.close()
})

test('rewrites legacy AI settings into profiles when saved', async () => {
  await writeFile(
    settingsFile(),
    JSON.stringify(
      {
        theme: 'light',
        ai: {
          baseUrl: 'https://legacy.example/v1',
          apiKey: 'sk-legacy',
          apiKeyEncrypted: false,
          model: 'legacy-model'
        }
      },
      null,
      2
    ),
    'utf8'
  )

  const reader = await launchReader(userDataDir)
  const dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()

  // 旧格式在内存中迁移成一条配置，直接出现在列表里
  await expect(dialog.getByText('legacy-model · legacy.example')).toBeVisible()
  await dialog.getByRole('button', { name: '编辑' }).click()
  await expect(dialog.locator('#ai-base-url')).toHaveValue('https://legacy.example/v1')
  await expect(dialog.locator('#ai-model')).toHaveValue('legacy-model')

  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog.getByText('已保存')).toBeVisible()

  await expect
    .poll(async () => (await readJsonFile<StoredSettings>(settingsFile()))?.ai.profiles?.length)
    .toBe(1)

  const stored = await readJsonFile<StoredSettings>(settingsFile())
  expect(stored?.ai.profiles?.[0]).toMatchObject({
    id: 'default',
    baseUrl: 'https://legacy.example/v1',
    model: 'legacy-model'
  })
  expect(stored?.ai.activeId).toBe('default')
  await reader.app.close()
})

test('rejects an invalid Base URL', async () => {
  const reader = await launchReader(userDataDir)
  const dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()
  await dialog.getByRole('button', { name: '新增模型' }).click()

  await dialog.locator('#ai-base-url').fill('ftp://example.com')
  await dialog.getByRole('button', { name: '保存' }).click()

  await expect(dialog.getByText('Base URL 需要是以 http:// 或 https:// 开头的地址')).toBeVisible()
  await expect.poll(async () => readJsonFile<StoredSettings>(settingsFile())).toBeNull()
  await reader.app.close()
})
