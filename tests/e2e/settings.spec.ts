import { expect, test, type Locator } from '@playwright/test'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createUserDataDir,
  launchReader,
  readJsonFile,
  removeUserDataDir,
  stubMessageBox,
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

const settingsFile = (): string => join(userDataDir, 'data', 'settings.json')

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
  await expect(dialog.locator('#library-directory')).toHaveValue(
    join(userDataDir, 'data', 'papers')
  )

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
        (await readJsonFile<StoredLibrary>(join(userDataDir, 'data', 'library.json')))?.papers[0]
          ?.path
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
  // Key 不回填到渲染进程，只能看到“已保存”的提示
  await expect(dialog.locator('#ai-api-key')).toHaveValue('')
  await expect(dialog.getByPlaceholder('留空表示保持现有 Key')).toBeVisible()

  // 渲染进程侧的设置只暴露 hasApiKey，不含明文或密文
  const publicProfile = await reader.page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        api: { getSettings: () => Promise<{ ai: { profiles: Record<string, unknown>[] } }> }
      }
    ).api
    const settings = await api.getSettings()
    return settings.ai.profiles[0]
  })
  expect(publicProfile).toMatchObject({ hasApiKey: true, model: 'deepseek-chat' })
  expect(publicProfile).not.toHaveProperty('apiKey')
  expect(publicProfile).not.toHaveProperty('apiKeyEncrypted')

  // preload 只暴露 window.api，不再暴露 electronAPI
  const bridge = await reader.page.evaluate(() => ({
    hasElectron: 'electron' in globalThis,
    apiType: typeof (globalThis as { api?: unknown }).api
  }))
  expect(bridge).toEqual({ hasElectron: false, apiType: 'object' })
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
    apiKey: 'sk-legacy',
    model: 'legacy-model'
  })
  expect(stored?.ai.activeId).toBe('default')
  await reader.app.close()
})

test('warns when the system key store is unavailable', async () => {
  const reader = await launchReader(userDataDir)

  // 模拟没有系统钥匙串的环境，再重新加载渲染进程让设置重新读取
  await reader.app.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = (): boolean => false
  })
  await reader.page.reload()

  const keyStorage = await reader.page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        api: { getSettings: () => Promise<{ keyStorage: string }> }
      }
    ).api
    return (await api.getSettings()).keyStorage
  })
  expect(keyStorage).toBe('plaintext')

  const dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()
  await expect(dialog.getByText(/系统安全存储不可用/)).toBeVisible()

  await reader.app.close()
})

test('requires native confirmation before sending an existing key to a new host', async () => {
  const reader = await launchReader(userDataDir)
  const dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()
  await dialog.getByRole('button', { name: '新增模型' }).click()
  await dialog.locator('#ai-base-url').fill('https://api.example.com/v1')
  await dialog.locator('#ai-model').fill('model-a')
  await dialog.locator('#ai-api-key').fill('sk-e2e-secret')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog.getByText('已保存')).toBeVisible()

  await dialog.getByRole('button', { name: '编辑' }).click()
  await dialog.locator('#ai-base-url').fill('https://evil.example/v1')

  // 用户在原生确认框里取消：保留原地址
  await stubMessageBox(reader.app, 0)
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog.getByText(/已取消保存/)).toBeVisible()
  await expect
    .poll(
      async () => (await readJsonFile<StoredSettings>(settingsFile()))?.ai.profiles?.[0].baseUrl
    )
    .toBe('https://api.example.com/v1')

  // 确认后才把新地址写入
  await stubMessageBox(reader.app, 1)
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog.getByText('已保存')).toBeVisible()
  await expect
    .poll(
      async () => (await readJsonFile<StoredSettings>(settingsFile()))?.ai.profiles?.[0].baseUrl
    )
    .toBe('https://evil.example/v1')
  await reader.app.close()
})

test('blocks in-app navigation, window.open and permission requests', async () => {
  const reader = await launchReader(userDataDir)
  const before = reader.page.url()

  // 非 http(s) 的外链既不打开窗口，也不交给系统浏览器
  const opened = await reader.page.evaluate(() => window.open('file:///etc/passwd'))
  expect(opened).toBeNull()
  expect(reader.page.url()).toBe(before)

  // 主窗口导航被拒绝，应用不会被带到本地文件
  await reader.page.evaluate(() => {
    window.location.href = 'file:///etc/passwd'
  })
  await expect.poll(() => reader.page.url()).toBe(before)

  const permission = await reader.page.evaluate(() =>
    navigator.permissions.query({ name: 'geolocation' }).then((status) => status.state)
  )
  expect(permission).toBe('denied')

  await reader.app.close()
})

test('rejects an invalid Base URL', async () => {
  const reader = await launchReader(userDataDir)
  const dialog = await openSettings(reader.page)
  await dialog.getByRole('button', { name: 'AI 服务' }).click()
  await dialog.getByRole('button', { name: '新增模型' }).click()

  await dialog.locator('#ai-base-url').fill('ftp://example.com')
  await dialog.getByRole('button', { name: '保存' }).click()

  await expect(
    dialog.getByText('Base URL 需要是 HTTPS 地址；本机服务可使用 http://localhost')
  ).toBeVisible()
  await expect.poll(async () => readJsonFile<StoredSettings>(settingsFile())).toBeNull()
  await reader.app.close()
})
