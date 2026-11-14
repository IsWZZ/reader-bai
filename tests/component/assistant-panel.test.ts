import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AssistantPanel from '@renderer/components/AssistantPanel.vue'
import { useAssistantStore } from '@renderer/store/assistant'
import { useSettingsStore } from '@renderer/store/settings'
import type {
  AiChatResult,
  AiProfile,
  AppSettings,
  ChatMessage,
  SettingsPatch,
  ToolInfo,
  ToolResult
} from '@renderer/types'

const PROFILE_A: AiProfile = {
  id: 'a',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
  model: 'gpt-test'
}

const PROFILE_B: AiProfile = {
  id: 'b',
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
  library: { directory: '' },
  keyStorage: 'encrypted'
})

const BASE_SETTINGS = makeSettings({
  theme: 'light',
  ai: { profiles: [PROFILE_A, PROFILE_B], activeId: 'a' }
})

let current: AppSettings

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn<(patch: SettingsPatch) => Promise<AppSettings>>()
const chatWithTools =
  vi.fn<
    (
      requestId: string,
      messages: ChatMessage[],
      profileId: string,
      tools?: string[],
      runId?: string
    ) => Promise<AiChatResult>
  >()
const listTools = vi.fn<() => Promise<ToolInfo[]>>()
const executeTool = vi.fn<(name: string, input: unknown) => Promise<ToolResult>>()
const abortChat = vi.fn<(requestId: string) => void>()
const startRun = vi.fn<() => Promise<{ id: string }>>()
const finishRun = vi.fn<(id: string) => Promise<{ steps: number }>>()
const cancelRun = vi.fn<(id: string) => Promise<void>>()
const onAiChunk = vi.fn(() => vi.fn())

const installApi = (): void => {
  window.api = {
    getSettings,
    updateSettings,
    chatWithTools,
    listTools,
    executeTool,
    abortChat,
    startRun,
    finishRun,
    cancelRun,
    onAiChunk
  } as unknown as Api
}

const reply = (text: string): AiChatResult => ({
  text,
  toolCalls: [],
  finishReason: 'stop'
})

const readTool = (name: string): ToolInfo => ({
  name,
  title: name,
  description: name,
  inputSchema: { type: 'object', properties: {} },
  risk: 'read',
  exposeToAi: true
})

const installSettings = (settings: AppSettings): void => {
  current = structuredClone(settings)
  getSettings.mockResolvedValue(structuredClone(current))
}

const mountPanel = (): VueWrapper => mount(AssistantPanel, { props: { width: 340 } })

const selectModels = (wrapper: VueWrapper): ReturnType<VueWrapper['get']> =>
  wrapper.get('select[aria-label="选择模型"]')

describe('AssistantPanel', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    getSettings.mockReset()
    updateSettings.mockReset()
    chatWithTools.mockReset()
    listTools.mockReset()
    executeTool.mockReset()
    abortChat.mockReset()
    startRun.mockReset()
    finishRun.mockReset()
    cancelRun.mockReset()
    onAiChunk.mockClear()
    startRun.mockResolvedValue({ id: 'run-1' })
    finishRun.mockResolvedValue({ steps: 1 })
    cancelRun.mockResolvedValue(undefined)
    listTools.mockResolvedValue([])
    executeTool.mockResolvedValue({ content: 'ok' })
    installSettings(BASE_SETTINGS)
    updateSettings.mockImplementation(async (patch) => {
      current = {
        theme: patch.theme ?? current.theme,
        language: patch.language ?? current.language,
        ai: {
          profiles: (patch.ai?.profiles ?? current.ai.profiles).map((profile) => ({ ...profile })),
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
            { id: 'c', baseUrl: 'https://api3.example.com/v1', hasApiKey: true, model: '' }
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
      'gpt-test · api.example.com',
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
    chatWithTools.mockImplementation(() => new Promise<AiChatResult>(() => undefined))
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
    chatWithTools.mockResolvedValue(reply('回复'))
    const wrapper = mountPanel()
    await wrapper.get('textarea[aria-label="向 AI 提问"]').setValue('你好')

    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(chatWithTools).not.toHaveBeenCalled()

    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(chatWithTools).toHaveBeenCalledTimes(1)
    expect(chatWithTools.mock.calls[0][1][1]).toEqual({ role: 'user', content: '你好' })
    expect(chatWithTools.mock.calls[0][2]).toBe('a')
    expect(wrapper.text()).toContain('回复')
    wrapper.unmount()
  })

  it('runs the agent loop with read-only tools when enabled', async () => {
    listTools.mockResolvedValue([
      readTool('library.list'),
      { ...readTool('annotations.remove'), risk: 'destructive' }
    ])
    chatWithTools
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'call-1', name: 'library.list', arguments: '{}' }],
        finishReason: 'tool_calls'
      })
      .mockResolvedValueOnce(reply('库里有一篇论文'))

    const wrapper = mountPanel()
    await wrapper.get('input[aria-label="使用工具"]').setValue(true)
    await wrapper.get('textarea[aria-label="向 AI 提问"]').setValue('库里有几篇论文？')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()

    expect(chatWithTools.mock.calls[0][3]).toEqual(['library.list'])
    expect(chatWithTools.mock.calls[0][4]).toBe('run-1')
    expect(executeTool).toHaveBeenCalledWith('library.list', {})
    expect(chatWithTools).toHaveBeenCalledTimes(2)
    expect(finishRun).toHaveBeenCalledWith('run-1')
    expect(wrapper.text()).toContain('调用工具：library.list')
    expect(wrapper.text()).toContain('库里有一篇论文')
    wrapper.unmount()
  })

  it('stops a streaming reply', async () => {
    chatWithTools.mockImplementation(() => new Promise<AiChatResult>(() => undefined))
    const wrapper = mountPanel()
    await wrapper.get('textarea[aria-label="向 AI 提问"]').setValue('你好')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()

    const stop = wrapper.get('button[aria-label="停止"]')
    await stop.trigger('click')

    expect(abortChat).toHaveBeenCalledTimes(1)
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
