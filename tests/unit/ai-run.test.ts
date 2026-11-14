import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunLimitError, startRun } from '../../src/main/ai-run'

describe('run lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks steps and usage', () => {
    const run = startRun()

    run.recordStep({ inputTokens: 10, outputTokens: 5 })

    expect(run.usage).toEqual({ steps: 1, inputTokens: 10, outputTokens: 5 })
  })

  it('aborts when the step budget is exceeded', () => {
    const run = startRun({ maxSteps: 1 })
    run.recordStep()

    expect(() => run.recordStep()).toThrow(RunLimitError)
    expect(run.isAborted).toBe(true)
    expect(run.abortReason).toBe('limit')

    // 中止后的调用统一报运行已中止
    expect(() => run.recordStep()).toThrow('运行已中止')
  })

  it('aborts when token budgets are exceeded', () => {
    const inputRun = startRun({ maxInputTokens: 10 })
    expect(() => inputRun.recordStep({ inputTokens: 11 })).toThrow('输入 token 超出预算')
    expect(inputRun.abortReason).toBe('limit')

    const outputRun = startRun({ maxOutputTokens: 10 })
    expect(() => outputRun.recordStep({ outputTokens: 11 })).toThrow('输出 token 超出预算')
    expect(outputRun.abortReason).toBe('limit')
  })

  it('cancels a run', () => {
    const run = startRun()

    run.cancel('user')

    expect(run.isAborted).toBe(true)
    expect(run.abortReason).toBe('user')
  })

  it('times out on the timer', async () => {
    vi.useFakeTimers()
    const run = startRun({ timeoutMs: 1000 })

    await vi.advanceTimersByTimeAsync(1000)

    expect(run.isAborted).toBe(true)
    expect(run.abortReason).toBe('timeout')
  })

  it('detects a timeout while recording a step', () => {
    let time = 0
    const run = startRun({ timeoutMs: 100 }, { now: () => time })

    time = 101

    expect(() => run.recordStep()).toThrow('运行超时')
    expect(run.abortReason).toBe('timeout')
  })

  it('keeps the first abort reason when cancelled again', async () => {
    vi.useFakeTimers()
    const run = startRun({ timeoutMs: 1000 })

    await vi.advanceTimersByTimeAsync(1000)
    run.cancel('user')

    expect(run.abortReason).toBe('timeout')
  })

  it('clears the timeout when disposed', async () => {
    vi.useFakeTimers()
    const run = startRun({ timeoutMs: 1000 })

    run.dispose()
    await vi.advanceTimersByTimeAsync(1000)

    expect(run.isAborted).toBe(false)
  })

  it('generates a distinct id for every run and ignores negative usage', () => {
    const first = startRun()
    const second = startRun()

    first.recordStep({ inputTokens: -10, outputTokens: -5 })

    expect(first.id).not.toBe(second.id)
    expect(first.usage).toEqual({ steps: 1, inputTokens: 0, outputTokens: 0 })
  })
})
