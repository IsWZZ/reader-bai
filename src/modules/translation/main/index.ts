import { registerTranslationIpc } from './ipc'
import { createTranslationRuntime, type TranslationRuntimeOptions } from './runtime'

export type TranslationModuleOptions = TranslationRuntimeOptions

export interface TranslationModule {
  /** 启动时注册 IPC；翻译进程本身在 translation:activate 时才 fork */
  registerIpc: () => void
  deactivate: () => Promise<void>
}

/**
 * B 层内置翻译模块的激活入口。
 * 它模仿插件主入口的 activate/deactivate 形态，但直接运行在应用进程体系里，
 * 不走 C 层插件的 manifest 校验、权限或 sandbox。
 */
export const createTranslationModule = (options: TranslationModuleOptions): TranslationModule => {
  const runtime = createTranslationRuntime(options)

  return {
    registerIpc: () => registerTranslationIpc(runtime),
    deactivate: () => runtime.stop()
  }
}
