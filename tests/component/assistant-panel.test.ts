import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AssistantPanel from '@renderer/components/AssistantPanel.vue'
import { useAssistantStore } from '@renderer/store/assistant'
import { useSettingsStore } from '@renderer/store/settings'
import type {
  AgentEvent,
  AgentEventPayload,
  AgentSessionInfo,
  AgentStartRequest,
  AiProfile,
  AppSettings,
  SettingsPatch
} from '@renderer/types'

const PROFILE_A: AiProfile = {
  id: 'a',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
  model: 'gpt-test'
}

const PROFILE_B: AiProfile = {
  id: 'b',
  provider: 'openai',
  baseUrl: 'https://api2.example.com/v1',
  hasApiKey: true,
  model: 'model-b'
}

const makeSettings = (
  settings: Omit<AppSettings, 'library' | 'keyStorage' | 'language'>,
  language = 'zh'
): AppSettings => ({
  ...settings,
  language,
  library: { directory: '', autoAnalyze: true },
  keyStorage: 'encrypted'
})

const BASE_SETTINGS = makeSettings({
  theme: 'light',
  ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'a' }
})

let current: AppSettings

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn<(patch: SettingsPatch) => Promise<AppSettings>>()
const abortChat = vi.fn<(requestId: string) => void>()
const startAgent = vi.fn<(request: AgentStartRequest) => Promise<AgentSessionInfo>>()
const cancelAgent = vi.fn<(id: string) => Promise<void>>()
const onAiChunk = vi.fn(() => vi.fn())
let agentHandler: ((payload: AgentEventPayload) => void) | null = null
const onAgentEvent = vi.fn((callback: (payload: AgentEventPayload) => void) => {
  agentHandler = callback
  return vi.fn()
})

const installApi = (): void => {
  window.api = {
    getSettings,
    updateSettings,
    abortChat,
    startAgent,
    cancelAgent,
    onAiChunk,
    onAgentEvent
  } as unknown as Api
}

const reply = (text: string): AgentEvent => ({
  type: 'done',
  text,
  steps: 1,
  finishReason: 'stop'
})

const emitAgent = (sessionId: string, event: AgentEvent): void => {
  agentHandler?.({ sessionId, event })
}

const installSettings = (settings: AppSettings): void => {
  current = structuredClone(settings)
  getSettings.mockResolvedValue(structuredClone(current))
}

const mountPanel = (): VueWrapper => {
  // 订阅 agent 事件通常由 Home 外壳发起；这里直接挂载面板时手动初始化
  useAssistantStore().initialize()
  return mount(AssistantPanel, { props: { width: 340 } })
}

const selectModels = (wrapper: VueWrapper): ReturnType<VueWrapper['get']> =>
  wrapper.get('select[aria-label="选择模型"]')

describe('AssistantPanel', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    getSettings.mockReset()
    updateSettings.mockReset()
    abortChat.mockReset()
    startAgent.mockReset()
    cancelAgent.mockReset()
    onAiChunk.mockClear()
    onAgentEvent.mockClear()
    agentHandler = null
    startAgent.mockResolvedValue({ id: 'session-1' })
    cancelAgent.mockResolvedValue(undefined)
    installSettings(BASE_SETTINGS)
    updateSettings.mockImplementation(async (patch) => {
      current = {
        theme: patch.theme ?? current.theme,
        language: patch.language ?? current.language,
        ai: {
          profiles: (patch.ai?.profiles ?? current.ai.profiles).map((profile) => {
            const existing = current.ai.profiles.find((item) => item.id === profile.id)
            return {
              ...profile,
              provider: profile.provider ?? existing?.provider ?? 'openai'
            }
          }),
          activeId: patch.ai?.activeId ?? current.ai.activeId
        },
        library: current.library,
        keyStorage: current.keyStorage
      }
      return structuredClone(current)
    })
    installApi()
    await useSettingsStore().initialize()
  })

  it('shows the add-profile hint when no AI profile exists', async () => {
    installSettings(makeSettings({ theme: 'light', ai: { profiles: [], activeId: '' } }))
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('请先在设置 → AI 服务中添加并补全配置')
    expect(wrapper.find('select[aria-label="选择模型"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the incomplete-profile hint for a partially filled profile', async () => {
    installSettings(
      makeSettings({
        theme: 'light',
        ai: { profiles: [{ ...PROFILE_A, model: '' }], activeId: 'a' }
      })
    )
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('所选 AI 服务的 Base URL、API Key 或模型不完整')
    expect(wrapper.find('select[aria-label="选择模型"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('lists every profile and falls back to the base URL for a missing model', async () => {
    installSettings(
      makeSettings({
        theme: 'light',
        ai: {
          profiles: [
            PROFILE_A,
            {
              id: 'c',
              provider: 'openai',
              baseUrl: 'https://api3.example.com/v1',
              hasApiKey: true,
              model: ''
            }
          ],
          activeId: 'a'
        }
      })
    )
    setActivePinia(createPinia())
    await useSettingsStore().initialize()

    const wrapper = mountPanel()
    const options = selectModels(wrapper).findAll('option')

    expect(options.map((option) => option.text())).toEqual([
      'gpt-test',
      'https://api3.example.com/v1'
    ])
    wrapper.unmount()
  })

  it('switches the active profile and clears the old translation', async () => {
    const store = useAssistantStore()
    store.translation = { source: 'Hello', text: '你好', loading: false, error: '' }
    const wrapper = mountPanel()
    const select = selectModels(wrapper)

    expect((select.element as HTMLSelectElement).value).toBe('a')

    await select.setValue('b')
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledWith({ ai: { activeId: 'b' } })
    expect(useSettingsStore().activeAiProfile?.id).toBe('b')
    expect(store.translation).toBeNull()
    expect((select.element as HTMLSelectElement).value).toBe('b')
    wrapper.unmount()
  })

  it('disables the profile select while a chat reply is streaming', async () => {
    startAgent.mockImplementation(() => new Promise<AgentSessionInfo>(() => undefined))
    const wrapper = mountPanel()

    await wrapper.get('textarea[aria-label="向 AI 提问"]').setValue('你好')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()

    expect(selectModels(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.get('button[aria-label="停止"]').trigger('click')
    await flushPromises()

    expect(selectModels(wrapper).attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('disables the profile select while a profile switch is saving', async () => {
    updateSettings.mockImplementation(() => new Promise<AppSettings>(() => undefined))
    const wrapper = mountPanel()

    await selectModels(wrapper).setValue('b')
    await flushPromises()

    expect(selectModels(wrapper).attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('renders the selected source and its translation', () => {
    const store = useAssistantStore()
    store.translation = {
      source: 'Hello paper',
      text: '你好，论文',
      loading: false,
      error: ''
    }

    const wrapper = mountPanel()

    expect(wrapper.get('section[aria-label="译文"]').text()).toContain('Hello paper')
    expect(wrapper.get('section[aria-label="译文"]').text()).toContain('你好，论文')
    wrapper.unmount()
  })

  it('renders translation errors', () => {
    const store = useAssistantStore()
    store.translation = {
      source: 'Hello',
      text: '',
      loading: false,
      error: '翻译失败，请稍后重试'
    }

    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('翻译失败，请稍后重试')
    wrapper.unmount()
  })

  it('sends chat messages with Enter but not with Shift+Enter', async () => {
    const wrapper = mountPanel()
    await wrapper.get('textarea[aria-label="向 AI 提问"]').setValue('你好')

    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(startAgent).not.toHaveBeenCalled()

    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(startAgent).toHaveBeenCalledTimes(1)
    const [request] = startAgent.mock.calls[0]
    expect(request.messages[request.messages.length - 1]).toEqual({
      role: 'user',
      content: '你好'
    })
    expect(request.profileId).toBe('a')
    expect(request.mode).toBe('chat')

    emitAgent('session-1', reply('回复'))
    await flushPromises()

    expect(wrapper.text()).toContain('回复')
    wrapper.unmount()
  })

  it('asks for agent mode and renders tool notes', async () => {
    const wrapper = mountPanel()
    await wrapper.get('input[aria-label="使用工具"]').setValue(true)
    await wrapper.get('textarea[aria-label="向 AI 提问"]').setValue('库里有几篇论文？')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()

    expect(startAgent.mock.calls[0][0].mode).toBe('agent')

    emitAgent('session-1', { type: 'chunk', delta: '查询中' })
    emitAgent('session-1', { type: 'tool-call', callId: 'call-1', name: 'library.list' })
    emitAgent('session-1', { type: 'chunk', delta: '，找到一篇论文' })
    emitAgent('session-1', reply('查询中，找到一篇论文'))
    await flushPromises()

    expect(wrapper.text()).toContain('调用工具：library.list')
    expect(wrapper.text()).toContain('找到一篇论文')
    wrapper.unmount()
  })

  it('stops a streaming reply', async () => {
    const wrapper = mountPanel()
    await wrapper.get('textarea[aria-label="向 AI 提问"]').setValue('你好')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()

    const stop = wrapper.get('button[aria-label="停止"]')
    await stop.trigger('click')

    expect(cancelAgent).toHaveBeenCalledWith('session-1')
    expect(wrapper.find('button[aria-label="发送"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('emits close from the header button', async () => {
    const wrapper = mountPanel()

    await wrapper.get('button[aria-label="关闭辅助面板"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
