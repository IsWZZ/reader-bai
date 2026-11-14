import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRunManager, RunLimitError } from '../../src/main/ai-run'

describe('run manager', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks steps and usage', () => {
    const manager = createRunManager()
    const run = manager.start()

    run.recordStep({ inputTokens: 10, outputTokens: 5 })

    expect(run.usage).toEqual({ steps: 1, inputTokens: 10, outputTokens: 5 })
    expect(manager.get(run.id)).toBe(run)

    run.dispose()
    expect(manager.get(run.id)).toBeUndefined()
  })

  it('aborts when the step budget is exceeded', () => {
    const manager = createRunManager()
    const run = manager.start({ maxSteps: 1 })
    run.recordStep()

    expect(() => run.recordStep()).toThrow(RunLimitError)
    expect(run.isAborted).toBe(true)
    expect(run.abortReason).toBe('limit')
    expect(manager.get(run.id)).toBeUndefined()

    // 中止后的调用统一报运行已中止
    expect(() => run.recordStep()).toThrow('运行已中止')
  })

  it('aborts when token budgets are exceeded', () => {
    const manager = createRunManager()

    const inputRun = manager.start({ maxInputTokens: 10 })
    expect(() => inputRun.recordStep({ inputTokens: 11 })).toThrow('输入 token 超出预算')
    expect(inputRun.abortReason).toBe('limit')

    const outputRun = manager.start({ maxOutputTokens: 10 })
    expect(() => outputRun.recordStep({ outputTokens: 11 })).toThrow('输出 token 超出预算')
    expect(outputRun.abortReason).toBe('limit')
  })

  it('cancels a run by id', () => {
    const manager = createRunManager()
    const run = manager.start()

    manager.cancel(run.id, 'user')

    expect(run.isAborted).toBe(true)
    expect(run.abortReason).toBe('user')
    expect(manager.get(run.id)).toBeUndefined()
  })

  it('stops all runs', () => {
    const manager = createRunManager()
    const first = manager.start()
    const second = manager.start()

    manager.stopAll()

    expect(first.isAborted).toBe(true)
    expect(second.isAborted).toBe(true)
    expect(first.abortReason).toBe('user')
    expect(second.abortReason).toBe('user')
  })

  it('times out on the timer', async () => {
    vi.useFakeTimers()
    const manager = createRunManager()
    const run = manager.start({ timeoutMs: 1000 })

    await vi.advanceTimersByTimeAsync(1000)

    expect(run.isAborted).toBe(true)
    expect(run.abortReason).toBe('timeout')
  })

  it('detects a timeout while recording a step', () => {
    let time = 0
    const manager = createRunManager({ now: () => time })
    const run = manager.start({ timeoutMs: 100 })

    time = 101

    expect(() => run.recordStep()).toThrow('运行超时')
    expect(run.abortReason).toBe('timeout')
  })
})
