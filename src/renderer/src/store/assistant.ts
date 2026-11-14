import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import type { AgentEvent, AgentEventPayload, AiChunk, ChatMessage } from '@renderer/types'
import { t } from '@renderer/lib/i18n'
import { useSettingsStore } from '@renderer/store/settings'

const TRANSLATE_DEBOUNCE_MS = 250
const MAX_SELECTION_CHARS = 4000
const MAX_HISTORY_MESSAGES = 20

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 工具调用记录，展示在气泡下方 */
  toolNotes?: string[]
}

export interface TranslationState {
  source: string
  text: string
  loading: boolean
  error: string
}

const TRANSLATE_SYSTEM_PROMPT =
  '你是学术论文翻译助手。请把用户提供的文本翻译成简体中文，保留术语与公式，只输出译文，不要解释。'

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

type ChatStatus = 'idle' | 'starting' | 'running'

/**
 * 右侧辅助面板的状态：选区译文 + AI 对话。
 * agent 循环在主进程的独立宿主里运行，这里只发起/取消会话并渲染事件。
 */
export const useAssistantStore = defineStore('assistant', () => {
  const settingsStore = useSettingsStore()

  const translation = ref<TranslationState | null>(null)
  const messages = ref<ChatEntry[]>([])
  const chatLoading = ref(false)
  const chatError = ref('')
  /** 是否让 agent 调用平台只读工具；写工具仍由确认弹窗拦截 */
  const agentMode = ref(false)

  const isConfigured = computed(() => settingsStore.isAiConfigured)

  let initialized = false
  let unsubscribeChunks: (() => void) | null = null
  let unsubscribeAgent: (() => void) | null = null
  let translateTimer: ReturnType<typeof setTimeout> | undefined
  let translateRequestId: string | null = null

  let chatStatus: ChatStatus = 'idle'
  let currentSessionId: string | null = null
  let activeReplyId: string | null = null
  let cancelRequested = false
  /** 会话 id 返回前就到达的事件，先按会话暂存 */
  let pendingEvents: AgentEventPayload[] = []
  let settleChat: { resolve: () => void; reject: (error: Error) => void } | null = null

  const handleChunk = (payload: AiChunk): void => {
    if (payload.requestId === translateRequestId && translation.value) {
      translation.value.text += payload.delta
    }
  }

  const findActiveReply = (): ChatEntry | undefined =>
    activeReplyId ? messages.value.find((item) => item.id === activeReplyId) : undefined

  const addToolNote = (note: string): void => {
    const entry = findActiveReply()
    if (!entry) return
    entry.toolNotes ??= []
    entry.toolNotes.push(note)
  }

  const applyAgentEvent = (event: AgentEvent): void => {
    switch (event.type) {
      case 'chunk': {
        const entry = findActiveReply()
        if (entry) entry.content += event.delta
        return
      }
      case 'tool-call':
        addToolNote(t('assistant.tool.call', { name: event.name }))
        return
      case 'tool-error':
        addToolNote(t('assistant.tool.error', { name: event.name, error: event.error }))
        return
      case 'done': {
        const entry = findActiveReply()
        if (entry && !entry.content && event.text) entry.content = event.text
        const settle = settleChat
        settleChat = null
        settle?.resolve()
        return
      }
      case 'error': {
        const entry = findActiveReply()
        if (entry && !entry.content) {
          messages.value = messages.value.filter((item) => item.id !== entry.id)
        }
        const settle = settleChat
        settleChat = null
        settle?.reject(new Error(event.message))
        return
      }
    }
  }

  const handleAgentEvent = (payload: AgentEventPayload): void => {
    if (chatStatus === 'starting') {
      pendingEvents.push(payload)
      return
    }
    if (payload.sessionId !== currentSessionId) return
    applyAgentEvent(payload.event)
  }

  /** 只订阅一次流式事件；组件在 onMounted 里调用 */
  const initialize = (): void => {
    if (initialized) return
    initialized = true
    const api = window.api
    if (!api) return
    unsubscribeChunks = api.onAiChunk(handleChunk)
    unsubscribeAgent = api.onAgentEvent(handleAgentEvent)
  }

  const abortTranslation = (): void => {
    if (!translateRequestId) return
    window.api?.abortChat(translateRequestId)
    translateRequestId = null
  }

  const translate = async (source: string): Promise<void> => {
    const api = window.api
    if (!api) {
      translation.value = {
        source,
        text: '',
        loading: false,
        error: t('assistant.error.environment')
      }
      return
    }
    const profile = settingsStore.activeAiProfile
    if (!profile || !isConfigured.value) {
      translation.value = { source, text: '', loading: false, error: t('assistant.configHint') }
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
        translation.value.error = cleanError(error, t('assistant.error.translate'))
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
        error: t('assistant.error.tooLong', { max: MAX_SELECTION_CHARS })
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
      chatError.value = t('assistant.error.environment')
      return
    }
    const profile = settingsStore.activeAiProfile
    if (!profile || !isConfigured.value) {
      chatError.value = t('assistant.configHint')
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

    chatLoading.value = true
    chatStatus = 'starting'
    activeReplyId = reply.id
    cancelRequested = false
    pendingEvents = []

    try {
      // 循环和预算都在主进程的 agent 宿主里，渲染进程只拿会话 id
      const session = await api.startAgent({
        messages: history,
        profileId: profile.id,
        mode: agentMode.value ? 'agent' : 'chat'
      })
      currentSessionId = session.id

      if (cancelRequested) {
        void api.cancelAgent(session.id).catch(() => undefined)
        return
      }

      chatStatus = 'running'
      const completion = new Promise<void>((resolve, reject) => {
        settleChat = { resolve, reject }
      })
      const buffered = pendingEvents
      pendingEvents = []
      for (const payload of buffered) {
        if (payload.sessionId === session.id) applyAgentEvent(payload.event)
      }
      await completion
    } catch (error) {
      if (cancelRequested) return
      const entry = messages.value.find((item) => item.id === reply.id)
      if (entry && !entry.content) {
        messages.value = messages.value.filter((item) => item.id !== reply.id)
      }
      chatError.value = cleanError(error, t('assistant.error.reply'))
    } finally {
      chatStatus = 'idle'
      currentSessionId = null
      activeReplyId = null
      cancelRequested = false
      pendingEvents = []
      settleChat = null
      chatLoading.value = false
    }
  }

  const stopChat = (): void => {
    const sessionId = currentSessionId
    const settle = settleChat
    settleChat = null
    currentSessionId = null
    chatStatus = 'idle'
    pendingEvents = []
    cancelRequested = true
    chatLoading.value = false

    if (sessionId) void window.api?.cancelAgent(sessionId).catch(() => undefined)
    settle?.resolve()
  }

  onScopeDispose(() => {
    unsubscribeChunks?.()
    unsubscribeChunks = null
    unsubscribeAgent?.()
    unsubscribeAgent = null
    if (translateTimer) clearTimeout(translateTimer)
    abortTranslation()
    if (currentSessionId) {
      void window.api?.cancelAgent(currentSessionId).catch(() => undefined)
    }
    currentSessionId = null
    settleChat?.resolve()
    settleChat = null
  })

  return {
    translation,
    messages,
    chatLoading,
    chatError,
    agentMode,
    isConfigured,
    initialize,
    handleSelection,
    resetTranslation,
    sendChat,
    stopChat
  }
})
