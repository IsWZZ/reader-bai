import { expect, test, type Page } from '@playwright/test'
import { createUserDataDir, launchReader, removeUserDataDir } from './helpers'

interface AgentApi {
  startAgent: (request: unknown) => Promise<{ id: string }>
  cancelAgent: (id: unknown) => Promise<void>
}

const startAgentError = (page: Page, request: unknown): Promise<string | null> =>
  page.evaluate(async (value) => {
    const api = (globalThis as unknown as { api: AgentApi }).api
    try {
      await api.startAgent(value)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, request)

const cancelAgent = (page: Page, id: unknown): Promise<void> =>
  page.evaluate(async (value) => {
    const api = (globalThis as unknown as { api: AgentApi }).api
    await api.cancelAgent(value)
  }, id)

const validRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  profileId: 'profile-1',
  mode: 'chat'
}

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

test('validates agent start requests in the main process', async () => {
  const { app, page } = await launchReader(userDataDir)

  expect(await startAgentError(page, 'fast')).toContain('启动参数必须是对象')
  expect(await startAgentError(page, {})).toContain('请先在设置中选择 AI 服务')
  expect(await startAgentError(page, { profileId: 'p', mode: 'auto', messages: [] })).toContain(
    '对话模式不正确'
  )
  expect(await startAgentError(page, { ...validRequest, profileId: '' })).toContain(
    '请先在设置中选择 AI 服务'
  )
  expect(await startAgentError(page, { ...validRequest, messages: [] })).toContain('消息不能为空')
  expect(await startAgentError(page, { ...validRequest, messages: 'hi' })).toContain(
    '消息格式不正确'
  )
  expect(await startAgentError(page, { ...validRequest, mode: 'fast' })).toContain('对话模式不正确')

  await app.close()
})

test('cancels agents idempotently', async () => {
  const { app, page } = await launchReader(userDataDir)

  // 未知或非法 id 都不应抛错
  await cancelAgent(page, 'missing')
  await cancelAgent(page, 42)
  await cancelAgent(page, null)

  await app.close()
})
