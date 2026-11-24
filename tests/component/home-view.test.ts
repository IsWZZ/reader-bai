// 外壳会间接 import 阅读器；jsdom 里没有 pdfjs 需要的 Worker
vi.mock('@renderer/lib/pdf', () => ({
  pdfjsLib: {},
  readPdfTitle: vi.fn()
}))

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '@renderer/views/Home.vue'
import ActivityBar from '@renderer/components/ActivityBar.vue'
import AssistantPanel from '@renderer/components/AssistantPanel.vue'
import LibraryPanel from '@renderer/components/LibraryPanel.vue'
import PdfViewer from '@renderer/components/PdfViewer.vue'
import PaperInfoPanel from '@renderer/components/PaperInfoPanel.vue'
import PaperTabs from '@renderer/components/PaperTabs.vue'
import RightSidebar from '@renderer/components/RightSidebar.vue'
import PluginViewFrame from '@renderer/components/PluginViewFrame.vue'
import SettingsDialog from '@renderer/components/SettingsDialog.vue'
import Toolbar from '@renderer/components/Toolbar.vue'
import { useSettingsStore } from '@renderer/store/settings'
import type { AiProfile, AppSettings, ChatMessage, Paper, PluginInfo } from '@renderer/types'

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

const PAPER: Paper = {
  id: 'paper-1',
  title: 'Paper One',
  path: '/papers/paper-1.pdf',
  fileName: 'paper-1.pdf',
  spaceId: null,
  titleSource: 'file',
  createdAt: 1
}

const chat =
  vi.fn<(requestId: string, messages: ChatMessage[], profileId: string) => Promise<string>>()

// 阅读面板嵌在 TabsContent 里，stub 时也要渲染默认插槽，才能找到 PdfViewer
const mountHome = (): VueWrapper =>
  mount(Home, { shallow: true, global: { renderStubDefaultSlot: true } })

const selectPaper = async (wrapper: VueWrapper, paper: Paper = PAPER): Promise<void> => {
  wrapper.findComponent(LibraryPanel).vm.$emit('select-paper', paper)
  await wrapper.vm.$nextTick()
}

const selectText = async (wrapper: VueWrapper, text: string): Promise<void> => {
  wrapper.findComponent(PdfViewer).vm.$emit('selection-change', { text, page: 1 })
  await wrapper.vm.$nextTick()
}

const openAssistant = async (wrapper: VueWrapper): Promise<void> => {
  wrapper.findComponent(ActivityBar).vm.$emit('toggle-assistant')
  await wrapper.vm.$nextTick()
}

const setSearch = async (wrapper: VueWrapper, value: string): Promise<void> => {
  wrapper.findComponent(Toolbar).vm.$emit('update:searchQuery', value)
  await wrapper.vm.$nextTick()
}

describe('Home search wiring', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    window.api = {
      getSettings: vi.fn(async () => structuredClone(SETTINGS)),
      updateSettings: vi.fn(),
      listPapers: vi.fn(async () => ({ spaces: [], papers: [] })),
      onAiChunk: vi.fn(() => vi.fn()),
      onAgentEvent: vi.fn(() => vi.fn())
    } as unknown as Api
    await useSettingsStore().initialize()
  })

  it('passes the toolbar query to the library panel', async () => {
    const wrapper = mountHome()

    await setSearch(wrapper, 'attention')

    expect(wrapper.findComponent(LibraryPanel).props('searchQuery')).toBe('attention')
  })

  it('opens the library when a query is entered', async () => {
    const wrapper = mountHome()
    wrapper.findComponent(ActivityBar).vm.$emit('toggle-library')
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(LibraryPanel).exists()).toBe(false)

    await setSearch(wrapper, 'attention')

    expect(wrapper.findComponent(LibraryPanel).exists()).toBe(true)
    expect(wrapper.findComponent(LibraryPanel).props('searchQuery')).toBe('attention')
  })

  it('opens AI settings instead of the assistant when no AI is configured', async () => {
    useSettingsStore().$patch({ settings: { ...SETTINGS, ai: { profiles: [], activeId: '' } } })
    const wrapper = mountHome()

    wrapper.findComponent(ActivityBar).vm.$emit('toggle-assistant')
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent(AssistantPanel).exists()).toBe(false)
    const dialog = wrapper.findComponent(SettingsDialog)
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('initialSection')).toBe('ai')
  })

  it('opens the requested settings section from the shell', async () => {
    const wrapper = mountHome()

    wrapper.findComponent(ActivityBar).vm.$emit('openSettings')
    await wrapper.vm.$nextTick()

    const dialog = wrapper.findComponent(SettingsDialog)
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('initialSection')).toBe('basic')
  })

  it('opens AI settings when the library requests configuration', async () => {
    const wrapper = mountHome()

    wrapper.findComponent(LibraryPanel).vm.$emit('request-ai-settings')
    await wrapper.vm.$nextTick()

    const dialog = wrapper.findComponent(SettingsDialog)
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('initialSection')).toBe('ai')
  })

  it('opens and closes an enabled plugin view in the main slot', async () => {
    const plugin: PluginInfo = {
      id: 'reader-bai.arxiv',
      name: 'arXiv',
      version: '1.0.0',
      permissions: ['documents:read'],
      commands: [],
      views: [
        {
          id: 'search.arxiv.panel',
          title: '搜索结果',
          location: 'main',
          entry: 'ui/index.html'
        }
      ],
      enabled: true,
      compatible: true
    }
    window.api = {
      getSettings: vi.fn(async () => structuredClone(SETTINGS)),
      updateSettings: vi.fn(),
      listPapers: vi.fn(async () => ({ spaces: [], papers: [] })),
      onAiChunk: vi.fn(() => vi.fn()),
      onAgentEvent: vi.fn(() => vi.fn()),
      listPlugins: vi.fn(async () => ({ plugins: [plugin], issues: [] }))
    } as unknown as Api

    const wrapper = mountHome()
    await flushPromises()

    // 没有论文也没有 main 插件视图时，论文库撑满主区域
    expect(wrapper.find('main').exists()).toBe(false)
    expect(wrapper.findComponent(LibraryPanel).props('expanded')).toBe(true)

    const bar = wrapper.findComponent(ActivityBar)
    expect(bar.props('pluginViews')).toEqual([
      {
        key: 'reader-bai.arxiv/search.arxiv.panel',
        label: 'arXiv · 搜索结果',
        location: 'main'
      }
    ])

    bar.vm.$emit('togglePluginView', 'reader-bai.arxiv/search.arxiv.panel')
    await wrapper.vm.$nextTick()

    const frame = wrapper.findComponent(PluginViewFrame)
    expect(frame.props('pluginId')).toBe('reader-bai.arxiv')
    expect(frame.props('pluginName')).toBe('arXiv')
    expect(frame.props('view')).toMatchObject({ id: 'search.arxiv.panel' })
    expect(wrapper.findComponent(LibraryPanel).props('expanded')).toBe(false)

    frame.vm.$emit('close')
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(PluginViewFrame).exists()).toBe(false)
    expect(wrapper.findComponent(LibraryPanel).props('expanded')).toBe(true)
  })

  it('shows paper info automatically after opening a paper, even without AI', async () => {
    useSettingsStore().$patch({ settings: { ...SETTINGS, ai: { profiles: [], activeId: '' } } })
    const wrapper = mountHome()
    await selectPaper(wrapper)

    const panel = wrapper.findComponent(PaperInfoPanel)
    expect(panel.exists()).toBe(true)
    expect(panel.props('paper')).toMatchObject({ id: PAPER.id })
    // 右侧栏宽度受限，窗口较窄时也要给阅读区留出更大空间
    expect(wrapper.findComponent(RightSidebar).props('maxWidth')).toBe('calc((100% - 360px) / 2)')
    // 没有 AI 配置也不会被带去设置页
    expect(wrapper.findComponent(SettingsDialog).props('open')).toBe(false)
  })

  it('reopens the paper info panel from the library', async () => {
    const wrapper = mountHome()
    await selectPaper(wrapper)

    wrapper.findComponent(RightSidebar).vm.$emit('close')
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(RightSidebar).exists()).toBe(false)

    const second: Paper = { ...PAPER, id: 'paper-2', path: '/papers/paper-2.pdf' }
    wrapper.findComponent(LibraryPanel).vm.$emit('show-paper-info', second)
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent(PaperInfoPanel).props('paper')).toMatchObject({ id: 'paper-2' })
    expect(wrapper.findComponent(PaperTabs).props('activeId')).toBe('paper-2')
  })

  it('keeps the assistant open instead of opening paper info automatically', async () => {
    const wrapper = mountHome()
    await selectPaper(wrapper)
    await openAssistant(wrapper)
    expect(wrapper.findComponent(PaperInfoPanel).exists()).toBe(false)

    await selectPaper(wrapper, { ...PAPER, id: 'paper-2', path: '/papers/paper-2.pdf' })

    expect(wrapper.findComponent(AssistantPanel).exists()).toBe(true)
    expect(wrapper.findComponent(PaperInfoPanel).exists()).toBe(false)
  })

  it('syncs metadata updates into the open paper shown in the info panel', async () => {
    const wrapper = mountHome()
    await selectPaper(wrapper)

    const updated: Paper = {
      ...PAPER,
      metadata: { authors: ['Ada Lovelace'], keywords: [], source: 'manual', analyzedAt: 1 }
    }
    wrapper.findComponent(LibraryPanel).vm.$emit('update-paper', updated)
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent(PaperInfoPanel).props('paper')?.metadata?.authors).toEqual([
      'Ada Lovelace'
    ])
    expect(wrapper.findComponent(PaperTabs).props('papers')[0]).toMatchObject({
      id: PAPER.id,
      metadata: updated.metadata
    })
  })
})

describe('Home reading area', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    window.api = {
      getSettings: vi.fn(async () => structuredClone(SETTINGS)),
      updateSettings: vi.fn(),
      listPapers: vi.fn(async () => ({ spaces: [], papers: [] })),
      onAiChunk: vi.fn(() => vi.fn()),
      onAgentEvent: vi.fn(() => vi.fn())
    } as unknown as Api
    await useSettingsStore().initialize()
  })

  it('keeps the library expanded until a paper is opened', async () => {
    const wrapper = mountHome()
    await flushPromises()

    expect(wrapper.find('main').exists()).toBe(false)
    expect(wrapper.findComponent(PaperTabs).exists()).toBe(false)
    expect(wrapper.findComponent(LibraryPanel).props('expanded')).toBe(true)

    await selectPaper(wrapper)

    expect(wrapper.find('main').exists()).toBe(true)
    expect(wrapper.findComponent(PaperTabs).exists()).toBe(true)
    expect(wrapper.findComponent(LibraryPanel).props('expanded')).toBe(false)
  })

  it('expands the library again when the last tab is closed', async () => {
    const wrapper = mountHome()
    await selectPaper(wrapper)

    wrapper.findComponent(PaperTabs).vm.$emit('close', PAPER.id)
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent(PaperTabs).exists()).toBe(false)
    expect(wrapper.find('main').exists()).toBe(false)
    expect(wrapper.findComponent(LibraryPanel).props('expanded')).toBe(true)
  })
})

describe('Home selection wiring', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    chat.mockReset()
    chat.mockResolvedValue('译文')
    window.api = {
      getSettings: vi.fn(async () => structuredClone(SETTINGS)),
      updateSettings: vi.fn(),
      chat,
      abortChat: vi.fn(),
      onAiChunk: vi.fn(() => vi.fn()),
      onAgentEvent: vi.fn(() => vi.fn())
    } as unknown as Api
    await useSettingsStore().initialize()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not request a translation while the assistant panel is closed', async () => {
    const wrapper = mountHome()
    await selectPaper(wrapper)

    await selectText(wrapper, 'hello')
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).not.toHaveBeenCalled()
  })

  it('translates the latest selection when the assistant panel opens', async () => {
    const wrapper = mountHome()
    await selectPaper(wrapper)

    await selectText(wrapper, 'first')
    await selectText(wrapper, 'hello')

    await openAssistant(wrapper)
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).toHaveBeenCalledTimes(1)
    expect(chat.mock.calls[0][1][1]).toEqual({ role: 'user', content: 'hello' })
  })

  it('translates a selection right away while the panel is open', async () => {
    const wrapper = mountHome()
    await selectPaper(wrapper)
    await openAssistant(wrapper)

    await selectText(wrapper, 'hello')
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('forgets the pending selection when the paper changes', async () => {
    const wrapper = mountHome()
    await selectPaper(wrapper)
    await selectText(wrapper, 'hello')

    await selectPaper(wrapper, { ...PAPER, id: 'paper-2', path: '/papers/paper-2.pdf' })
    await openAssistant(wrapper)
    await vi.advanceTimersByTimeAsync(250)

    expect(chat).not.toHaveBeenCalled()
  })

  it('keeps opened papers as tabs and activates the latest one', async () => {
    const wrapper = mountHome()
    await selectPaper(wrapper)

    const second = { ...PAPER, id: 'paper-2', path: '/papers/paper-2.pdf', title: 'Paper Two' }
    await selectPaper(wrapper, second)

    const tabs = wrapper.findComponent(PaperTabs)
    expect(tabs.props('papers')).toHaveLength(2)
    expect(tabs.props('activeId')).toBe('paper-2')
    expect(wrapper.findAllComponents(PdfViewer)).toHaveLength(2)
  })
})
