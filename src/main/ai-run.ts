// Agent run 的生命周期边界。
// agent 宿主只负责循环；平台负责 runId、取消、预算和超时，
// 这样即使宿主死循环，也不能无限消耗 token 或让用户无法停止。

export type RunAbortReason = 'user' | 'limit' | 'timeout' | 'error'

export interface RunUsage {
  steps: number
  inputTokens: number
  outputTokens: number
}

export interface RunLimits {
  /** 允许的最大模型调用步数；达到上限后下一次 recordStep 会中止并抛错 */
  maxSteps?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  /** 运行超时，毫秒 */
  timeoutMs?: number
}

export interface RunStepUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface AgentRun {
  readonly id: string
  readonly signal: AbortSignal
  readonly usage: RunUsage
  readonly abortReason: RunAbortReason | null
  readonly isAborted: boolean
  /** 记录一次模型调用；超过预算时中止运行并抛出 RunLimitError */
  recordStep: (usage?: RunStepUsage) => void
  cancel: (reason?: RunAbortReason) => void
  /** 正常结束时释放定时器；中止时由 cancel/limit 自动清理 */
  dispose: () => void
}

export class RunLimitError extends Error {
  readonly reason: RunAbortReason

  constructor(message: string, reason: RunAbortReason) {
    super(message)
    this.name = 'RunLimitError'
    this.reason = reason
  }
}

export interface StartRunOptions {
  /** 注入时钟，便于测试按虚拟时间判断超时 */
  now?: () => number
}

let runSequence = 0

const createRunId = (): string => {
  runSequence = (runSequence + 1) % 0xffffff
  return `${Date.now().toString(36)}-${runSequence.toString(36)}`
}

/** 创建一个独立的 run；调用方（agent runtime）负责保存并在结束时 dispose */
export const startRun = (limits: RunLimits = {}, options: StartRunOptions = {}): AgentRun => {
  const now = options.now ?? Date.now
  const id = createRunId()
  const controller = new AbortController()
  const usage: RunUsage = { steps: 0, inputTokens: 0, outputTokens: 0 }
  const startedAt = now()
  let abortReason: RunAbortReason | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const cleanup = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const stop = (reason: RunAbortReason): void => {
    if (controller.signal.aborted) return
    abortReason = reason
    cleanup()
    controller.abort()
  }

  if (limits.timeoutMs !== undefined && limits.timeoutMs > 0) {
    timer = setTimeout(() => stop('timeout'), limits.timeoutMs)
  }

  return {
    id,
    signal: controller.signal,
    usage,
    get abortReason(): RunAbortReason | null {
      return abortReason
    },
    get isAborted(): boolean {
      return controller.signal.aborted
    },
    recordStep: (stepUsage: RunStepUsage = {}): void => {
      if (controller.signal.aborted) {
        throw new RunLimitError('运行已中止', abortReason ?? 'user')
      }

      usage.steps += 1
      usage.inputTokens += Math.max(0, stepUsage.inputTokens ?? 0)
      usage.outputTokens += Math.max(0, stepUsage.outputTokens ?? 0)

      if (limits.maxSteps !== undefined && usage.steps > limits.maxSteps) {
        stop('limit')
        throw new RunLimitError(`已达到最大步数（${limits.maxSteps}）`, 'limit')
      }
      if (limits.maxInputTokens !== undefined && usage.inputTokens > limits.maxInputTokens) {
        stop('limit')
        throw new RunLimitError('输入 token 超出预算', 'limit')
      }
      if (limits.maxOutputTokens !== undefined && usage.outputTokens > limits.maxOutputTokens) {
        stop('limit')
        throw new RunLimitError('输出 token 超出预算', 'limit')
      }
      if (limits.timeoutMs !== undefined && now() - startedAt > limits.timeoutMs) {
        stop('timeout')
        throw new RunLimitError('运行超时', 'timeout')
      }
    },
    cancel: (reason: RunAbortReason = 'user'): void => stop(reason),
    dispose: cleanup
  }
}
