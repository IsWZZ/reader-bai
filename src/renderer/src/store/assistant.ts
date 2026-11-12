import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import type { AiChunk, ChatMessage } from '@renderer/types'
import { useSettingsStore } from '@renderer/store/settings'

const TRANSLATE_DEBOUNCE_MS = 250
const MAX_SELECTION_CHARS = 4000
const MAX_HISTORY_MESSAGES = 20

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface TranslationState {
  source: string
  text: string
  loading: boolean
  error: string
}

const CONFIG_HINT = '请先在设置 → AI 服务中配置 Base URL、API Key 和模型'

const TRANSLATE_SYSTEM_PROMPT =
  '你是学术论文翻译助手。请把用户提供的文本翻译成简体中文，保留术语与公式，只输出译文，不要解释。'

const CHAT_SYSTEM_PROMPT = '你是一个简洁、准确的学术阅读助手，请用中文回答用户的问题。'

const createId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// Electron 会把主进程抛出的错误包装成 "Error invoking remote method '...': Error: ..."
const cleanError = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback
  const message = error.message
    .replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '')
    .trim()
  return message || fallback
}

/**
 * 右侧辅助面板的状态：选区译文 + AI 对话。
 * 放在 store 里，关闭面板或切换论文时聊天记录不会丢。
 */
export const useAssistantStore = defineStore('assistant', () => {
  const settingsStore = useSettingsStore()

  const translation = ref<TranslationState | null>(null)
  const messages = ref<ChatEntry[]>([])
  const chatLoading = ref(false)
  const chatError = ref('')

  const isConfigured = computed(() => settingsStore.isAiConfigured)

  let initialized = false
  let unsubscribe: (() => void) | null = null
  let translateTimer: ReturnType<typeof setTimeout> | undefined
  let translateRequestId: string | null = null
  let chatRequestId: string | null = null

  const handleChunk = (payload: AiChunk): void => {
    if (payload.requestId === translateRequestId && translation.value) {
      translation.value.text += payload.delta
      return
    }
    if (payload.requestId === chatRequestId) {
      const last = messages.value[messages.value.length - 1]
      if (last && last.role === 'assistant') last.content += payload.delta
    }
  }

  /** 只订阅一次流式事件；组件在 onMounted 里调用 */
  const initialize = (): void => {
    if (initialized) return
    initialized = true
    const api = window.api
    if (api) unsubscribe = api.onAiChunk(handleChunk)
  }

  const abortTranslation = (): void => {
    if (!translateRequestId) return
    window.api?.abortChat(translateRequestId)
    translateRequestId = null
  }

  const translate = async (source: string): Promise<void> => {
    const api = window.api
    if (!api) {
      translation.value = { source, text: '', loading: false, error: '当前环境无法调用 AI 服务' }
      return
    }
    const profile = settingsStore.activeAiProfile
    if (!profile || !isConfigured.value) {
      translation.value = { source, text: '', loading: false, error: CONFIG_HINT }
      return
    }

    const requestId = createId()
    translateRequestId = requestId
    translation.value = { source, text: '', loading: true, error: '' }

    try {
      const result = await api.chat(
        requestId,
        [
          { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
          { role: 'user', content: source }
        ],
        profile.id
      )
      if (translateRequestId !== requestId) return
      if (translation.value) {
        if (result) translation.value.text = result
        translation.value.loading = false
      }
    } catch (error) {
      if (translateRequestId !== requestId) return
      if (translation.value) {
        translation.value.loading = false
        translation.value.error = cleanError(error, '翻译失败，请稍后重试')
      }
    } finally {
      if (translateRequestId === requestId) translateRequestId = null
    }
  }

  /** PdfViewer 每次选中文本时调用：防抖后自动翻译 */
  const handleSelection = (text: string): void => {
    const source = text.trim()
    if (!source) return

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
        error: `选中的文本过长（最多 ${MAX_SELECTION_CHARS} 字符）`
      }
      return
    }

    translateTimer = setTimeout(() => {
      translateTimer = undefined
      void translate(source)
    }, TRANSLATE_DEBOUNCE_MS)
  }

  /** 切换论文时清空译文，聊天记录保留 */
  const resetTranslation = (): void => {
    if (translateTimer) {
      clearTimeout(translateTimer)
      translateTimer = undefined
    }
    abortTranslation()
    translation.value = null
  }

  const sendChat = async (input: string): Promise<void> => {
    const content = input.trim()
    if (!content || chatLoading.value) return

    chatError.value = ''
    const api = window.api
    if (!api) {
      chatError.value = '当前环境无法调用 AI 服务'
      return
    }
    const profile = settingsStore.activeAiProfile
    if (!profile || !isConfigured.value) {
      chatError.value = CONFIG_HINT
      return
    }

    messages.value.push({ id: createId(), role: 'user', content })
    const reply: ChatEntry = { id: createId(), role: 'assistant', content: '' }
    messages.value.push(reply)

    // 只带最近若干轮，且发送普通对象，避免响应式代理无法结构化克隆
    const history = messages.value
      .filter((item) => item.content.trim())
      .slice(-MAX_HISTORY_MESSAGES)
      .map<ChatMessage>((item) => ({ role: item.role, content: item.content }))

    const requestId = createId()
    chatRequestId = requestId
    chatLoading.value = true

    try {
      const result = await api.chat(
        requestId,
        [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, ...history],
        profile.id
      )
      if (chatRequestId !== requestId) return
      if (result) reply.content = result
    } catch (error) {
      if (chatRequestId !== requestId) return
      if (!reply.content) {
        messages.value = messages.value.filter((item) => item.id !== reply.id)
      }
      chatError.value = cleanError(error, 'AI 回复失败，请稍后重试')
    } finally {
      if (chatRequestId === requestId) {
        chatRequestId = null
        chatLoading.value = false
      }
    }
  }

  const stopChat = (): void => {
    if (chatRequestId) {
      window.api?.abortChat(chatRequestId)
      chatRequestId = null
    }
    chatLoading.value = false
  }

  onScopeDispose(() => {
    unsubscribe?.()
    unsubscribe = null
    if (translateTimer) clearTimeout(translateTimer)
    abortTranslation()
    if (chatRequestId) {
      window.api?.abortChat(chatRequestId)
      chatRequestId = null
    }
  })

  return {
    translation,
    messages,
    chatLoading,
    chatError,
    isConfigured,
    initialize,
    handleSelection,
    resetTranslation,
    sendChat,
    stopChat
  }
})
