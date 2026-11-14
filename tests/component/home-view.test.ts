// 外壳会间接 import 阅读器；jsdom 里没有 pdfjs 需要的 Worker
vi.mock('@renderer/lib/pdf', () => ({
  pdfjsLib: {},
  readPdfTitle: vi.fn()
}))

import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '@renderer/views/Home.vue'
import ActivityBar from '@renderer/components/ActivityBar.vue'
import LibraryPanel from '@renderer/components/LibraryPanel.vue'
import PdfViewer from '@renderer/components/PdfViewer.vue'
import Toolbar from '@renderer/components/Toolbar.vue'
import { useSettingsStore } from '@renderer/store/settings'
import type { AiProfile, AppSettings, ChatMessage, Paper } from '@renderer/types'

const PROFILE: AiProfile = {
  id: 'a',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
  model: 'gpt-test'
}

const SETTINGS: AppSettings = {
  theme: 'light',
  language: 'zh',
  ai: { profiles: [PROFILE], activeId: 'a' },
  library: { directory: '' },
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

const mountHome = (): VueWrapper => mount(Home, { shallow: true })

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
})
