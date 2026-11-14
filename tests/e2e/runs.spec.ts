import { expect, test, type Page } from '@playwright/test'
import { createUserDataDir, launchReader, removeUserDataDir } from './helpers'

interface RunUsage {
  steps: number
  inputTokens: number
  outputTokens: number
}

interface RunLimits {
  maxSteps?: number
  timeoutMs?: number
}

interface RunApi {
  startRun: (limits?: RunLimits) => Promise<{ id: string }>
  finishRun: (id: string) => Promise<RunUsage>
  cancelRun: (id: string) => Promise<void>
}

const startRun = (page: Page, limits?: RunLimits): Promise<{ id: string }> =>
  page.evaluate(async (value) => {
    const api = (globalThis as unknown as { api: RunApi }).api
    return api.startRun(value ?? undefined)
  }, limits ?? null)

const finishRun = (page: Page, id: unknown): Promise<RunUsage | string> =>
  page.evaluate(async (runId) => {
    const api = (globalThis as unknown as { api: RunApi }).api
    try {
      return await api.finishRun(runId as string)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, id)

const cancelRun = (page: Page, id: string): Promise<void> =>
  page.evaluate(async (runId) => {
    const api = (globalThis as unknown as { api: RunApi }).api
    await api.cancelRun(runId)
  }, id)

const startRunError = (page: Page, limits: unknown): Promise<string | null> =>
  page.evaluate(async (value) => {
    const api = (globalThis as unknown as { api: RunApi }).api
    try {
      await api.startRun(value as RunLimits)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, limits)

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

test('starts and finishes a run with usage', async () => {
  const { app, page } = await launchReader(userDataDir)

  const run = await startRun(page, { maxSteps: 3, timeoutMs: 5000 })
  expect(run.id).toEqual(expect.any(String))

  await expect(finishRun(page, run.id)).resolves.toEqual({
    steps: 0,
    inputTokens: 0,
    outputTokens: 0
  })
  expect(await finishRun(page, run.id)).toContain('运行不存在或已结束')

  await app.close()
})

test('cancels a run and rejects unknown identifiers', async () => {
  const { app, page } = await launchReader(userDataDir)

  const run = await startRun(page)
  await cancelRun(page, run.id)
  expect(await finishRun(page, run.id)).toContain('运行不存在或已结束')
  // 取消不存在的 run 是幂等的，不应抛错
  await cancelRun(page, 'missing')

  expect(await finishRun(page, 42)).toContain('运行标识不正确')

  await app.close()
})

test('validates run limits in the main process', async () => {
  const { app, page } = await launchReader(userDataDir)

  expect(await startRunError(page, { maxSteps: 0 })).toContain('步数上限必须是')
  expect(await startRunError(page, { maxSteps: 21 })).toContain('步数上限必须是')
  expect(await startRunError(page, { timeoutMs: 10 })).toContain('超时时间必须是')
  expect(await startRunError(page, 'fast')).toContain('运行限制必须是对象')

  await app.close()
})
