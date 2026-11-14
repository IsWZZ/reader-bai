import { ipcMain } from 'electron'
import type { RunLimits, RunManager, RunUsage } from '../ai-run'

const MAX_RUN_ID_LENGTH = 100
const MAX_STEPS_LIMIT = 20
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 10 * 60 * 1000

const readRunId = (value: unknown): string => {
  if (typeof value !== 'string' || !value || value.length > MAX_RUN_ID_LENGTH) {
    throw new Error('运行标识不正确')
  }
  return value
}

const parseLimits = (value: unknown): RunLimits => {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('运行限制必须是对象')

  const record = value as Record<string, unknown>
  const limits: RunLimits = {}
  if (record.maxSteps !== undefined) {
    if (
      typeof record.maxSteps !== 'number' ||
      !Number.isInteger(record.maxSteps) ||
      record.maxSteps < 1 ||
      record.maxSteps > MAX_STEPS_LIMIT
    ) {
      throw new Error(`步数上限必须是 1 到 ${MAX_STEPS_LIMIT} 之间的整数`)
    }
    limits.maxSteps = record.maxSteps
  }
  if (record.timeoutMs !== undefined) {
    if (
      typeof record.timeoutMs !== 'number' ||
      !Number.isInteger(record.timeoutMs) ||
      record.timeoutMs < MIN_TIMEOUT_MS ||
      record.timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new Error(`超时时间必须是 ${MIN_TIMEOUT_MS} 到 ${MAX_TIMEOUT_MS} 毫秒之间的整数`)
    }
    limits.timeoutMs = record.timeoutMs
  }
  return limits
}

/** agent run 的生命周期：预算和取消由平台持有，调用方（模块/插件）只能按 runId 使用 */
export const registerRunsIpc = (runs: RunManager): void => {
  ipcMain.handle('runs:start', (_event, limits: unknown) => {
    const run = runs.start(parseLimits(limits))
    return { id: run.id }
  })

  ipcMain.handle('runs:finish', (_event, id: unknown): RunUsage => {
    const run = runs.get(readRunId(id))
    if (!run) throw new Error('运行不存在或已结束')
    const usage = { ...run.usage }
    run.dispose()
    return usage
  })

  ipcMain.handle('runs:cancel', (_event, id: unknown) => {
    runs.cancel(readRunId(id))
  })
}
