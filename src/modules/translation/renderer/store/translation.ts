import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import type { TranslationChunk } from '@renderer/types'
import { t } from '@renderer/lib/i18n'
import { useSettingsStore } from '@renderer/store/settings'
import { cleanError, createId } from '../lib/translation'

const TRANSLATE_DEBOUNCE_MS = 250
const MAX_SELECTION_CHARS = 4000

export interface TranslationState {
  source: string
  text: string
  loading: boolean
  error: string
}

/**
 * 选区翻译的状态。翻译逻辑和模型请求在独立的 translation-host 进程里；
 * 这里只负责防抖、激活进程、提交选区、渲染流式增量和取消。
 */
export const useTranslationStore = defineStore('translation', () => {
  const settingsStore = useSettingsStore()

  const translation = ref<TranslationState | null>(null)
  const activationError = ref('')
  const isConfigured = computed(() => settingsStore.isAiConfigured)

  let initialized = false
  let unsubscribeChunks: (() => void) | null = null
  let translateTimer: ReturnType<typeof setTimeout> | undefined
  let translateRequestId: string | null = null
  /** 面板可见时才自动翻译；关闭时只记录最近一次选区 */
  let autoTranslate = false
  let pendingSource: string | null = null
  let activation: Promise<void> | null = null

  const handleChunk = (payload: TranslationChunk): void => {
    if (payload.requestId === translateRequestId && translation.value) {
      translation.value.text += payload.delta
    }
  }

  /** 只订阅一次流式事件；外壳在 onMounted 里调用 */
  const initialize = (): void => {
    if (initialized) return
    initialized = true
    unsubscribeChunks = window.api?.onTranslationChunk(handleChunk) ?? null
  }

  /**
   * 启动翻译进程。活动栏点击时调用；成功后缓存 Promise，
   * 关闭面板不会停止进程，应用退出由主进程负责。
   */
  const activate = (): Promise<void> => {
    if (activation) return activation
    const api = window.api

    const promise = (async () => {
      if (!api) throw new Error(t('translation.error.environment'))
      await api.activateTranslation()
      activationError.value = ''
    })()

    activation = promise.catch((error: unknown) => {
      // 失败时允许下一次点击重试
      activation = null
      activationError.value = cleanError(error, t('translation.error.activate'))
      throw new Error(activationError.value)
    })

    return activation
  }

  const abortTranslation = (): void => {
    if (!translateRequestId) return
    window.api?.abortTranslation(translateRequestId)
    translateRequestId = null
  }

  const translate = async (source: string): Promise<void> => {
    const api = window.api
    if (!api) {
      translation.value = {
        source,
        text: '',
        loading: false,
        error: t('translation.error.environment')
      }
      return
    }

    const profile = settingsStore.activeAiProfile
    if (!profile || !isConfigured.value) {
      translation.value = { source, text: '', loading: false, error: t('translation.configHint') }
      return
    }

    try {
      await activate()
    } catch (error) {
      translation.value = {
        source,
        text: '',
        loading: false,
        error: cleanError(error, t('translation.error.activate'))
      }
      return
    }

    const requestId = createId()
    translateRequestId = requestId
    translation.value = { source, text: '', loading: true, error: '' }

    try {
      const result = await api.translate({ requestId, source, profileId: profile.id })
      if (translateRequestId !== requestId) return
      if (translation.value) {
        if (result) translation.value.text = result
        translation.value.loading = false
      }
    } catch (error) {
      if (translateRequestId !== requestId) return
      if (translation.value) {
        translation.value.loading = false
        translation.value.error = cleanError(error, t('translation.error.translate'))
      }
    } finally {
      if (translateRequestId === requestId) translateRequestId = null
    }
  }

  const scheduleTranslation = (source: string): void => {
    const current = translation.value
    // 同一段文本不重复翻译；上次失败时允许重新选中重试
    if (current && current.source === source && !current.error) return

    if (translateTimer) {
      clearTimeout(translateTimer)
      translateTimer = undefined
    }
    abortTranslation()

    if (source.length > MAX_SELECTION_CHARS) {
      translation.value = {
        source,
        text: '',
        loading: false,
        error: t('translation.error.tooLong', { max: MAX_SELECTION_CHARS })
      }
      return
    }

    translateTimer = setTimeout(() => {
      translateTimer = undefined
      void translate(source)
    }, TRANSLATE_DEBOUNCE_MS)
  }

  /**
   * PdfViewer 每次选中文本时调用。
   * 面板关闭时只记住最新选区，避免在用户看不到结果时发起请求；
   * 打开面板时由 setAutoTranslate 触发这段选区的翻译。
   */
  const handleSelection = (text: string): void => {
    const source = text.trim()
    if (!source) return

    pendingSource = source
    if (autoTranslate) scheduleTranslation(source)
  }

  /** 由外壳在面板显示/隐藏时调用 */
  const setAutoTranslate = (enabled: boolean): void => {
    if (autoTranslate === enabled) return
    autoTranslate = enabled

    if (enabled) {
      if (pendingSource) scheduleTranslation(pendingSource)
      return
    }

    // 关闭面板时取消还没发出的防抖请求；选区保留，重新打开后再翻译
    if (translateTimer) {
      clearTimeout(translateTimer)
      translateTimer = undefined
    }
  }

  /** 切换论文时清空译文和待翻译选区 */
  const resetTranslation = (): void => {
    if (translateTimer) {
      clearTimeout(translateTimer)
      translateTimer = undefined
    }
    abortTranslation()
    translation.value = null
    pendingSource = null
  }

  onScopeDispose(() => {
    unsubscribeChunks?.()
    unsubscribeChunks = null
    if (translateTimer) clearTimeout(translateTimer)
    abortTranslation()
  })

  return {
    translation,
    activationError,
    isConfigured,
    initialize,
    activate,
    handleSelection,
    setAutoTranslate,
    resetTranslation
  }
})
