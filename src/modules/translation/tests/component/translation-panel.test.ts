import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { useSettingsStore } from '@renderer/store/settings'
import { useTranslationStore } from '../../renderer/store/translation'
import TranslationPanel from '../../renderer/components/TranslationPanel.vue'
import type { AiProfile, AppSettings } from '@renderer/types'

const PROFILE: AiProfile = {
  id: 'a',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
  model: 'gpt-test',
  enabled: true
}

const SETTINGS: AppSettings = {
  theme: 'light',
  language: 'zh',
  ai: { profiles: [PROFILE], activeId: 'a' },
  library: { directory: '', autoAnalyze: true },
  keyStorage: 'encrypted'
}

const getSettings = vi.fn<() => Promise<AppSettings>>()
const updateSettings = vi.fn(async () => structuredClone(SETTINGS))

const mountPanel = async (settings: AppSettings = SETTINGS): Promise<VueWrapper> => {
  setActivePinia(createPinia())
  getSettings.mockResolvedValue(structuredClone(settings))
  window.api = {
    getSettings,
    updateSettings,
    activateTranslation: vi.fn(async () => undefined),
    translate: vi.fn(async () => '译文'),
    abortTranslation: vi.fn(),
    onTranslationChunk: vi.fn(() => vi.fn())
  } as unknown as Api
  await useSettingsStore().initialize()
  return mount(TranslationPanel)
}

beforeEach(() => {
  getSettings.mockReset()
  updateSettings.mockReset()
})

describe('TranslationPanel', () => {
  it('shows the model selector and the selection hint', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.find('[role="combobox"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('译文')
    expect(wrapper.text()).toContain('在阅读区选中文本即可自动查看译文。')
  })

  it('renders the source text, loading skeleton and streamed translation', async () => {
    const wrapper = await mountPanel()
    const store = useTranslationStore()

    store.translation = { source: 'Hello', text: '', loading: true, error: '' }
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Hello')
    expect(wrapper.text()).toContain('翻译中…')
    expect(wrapper.findComponent(Skeleton).exists()).toBe(true)

    store.translation = { source: 'Hello', text: '你好', loading: false, error: '' }
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('你好')
    expect(wrapper.findComponent(Skeleton).exists()).toBe(false)
  })

  it('shows translation errors', async () => {
    const wrapper = await mountPanel()
    const store = useTranslationStore()

    store.translation = {
      source: 'Hello',
      text: '',
      loading: false,
      error: '翻译失败，请稍后重试'
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('翻译失败，请稍后重试')
  })

  it('shows configuration hints when no profile is available', async () => {
    const wrapper = await mountPanel({ ...SETTINGS, ai: { profiles: [], activeId: '' } })

    expect(wrapper.find('[role="combobox"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('请先在设置 → AI 服务中添加并补全配置。')
  })

  it('shows the activation error from the store', async () => {
    const wrapper = await mountPanel()
    const store = useTranslationStore()

    store.activationError = '翻译进程启动失败，请重试'
    await flushPromises()

    expect(wrapper.text()).toContain('翻译进程启动失败，请重试')
  })

  it('does not render chat or tool controls anymore', async () => {
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('向 AI 提问')
    expect(wrapper.text()).not.toContain('使用工具')
  })
})
