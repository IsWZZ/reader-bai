import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LibraryPanel from '@renderer/components/LibraryPanel.vue'
import { readPdfTitle } from '@renderer/lib/pdf'
import { useSettingsStore } from '@renderer/store/settings'
import type { LibraryData, Paper, PaperMetadata, PaperMetadataInput, Space } from '@renderer/types'

// 避免在 jsdom 里加载 pdf.js 的 worker，只验证标题回填的调用流程
vi.mock('@renderer/lib/pdf', () => ({ readPdfTitle: vi.fn() }))

const readPdfTitleMock = vi.mocked(readPdfTitle)

const listPapers = vi.fn<() => Promise<LibraryData>>()
const createSpace = vi.fn<(name: string) => Promise<LibraryData>>()
const renameSpace = vi.fn<(id: string, name: string) => Promise<LibraryData>>()
const deleteSpace = vi.fn<(id: string) => Promise<LibraryData>>()
const renamePaper =
  vi.fn<(id: string, title: string, source: 'metadata' | 'user') => Promise<LibraryData>>()
const movePaper = vi.fn<(id: string, spaceId: string | null) => Promise<LibraryData>>()
const setPaperFavorite = vi.fn<(id: string, favorite: boolean) => Promise<LibraryData>>()
const removePaper = vi.fn<(id: string) => Promise<LibraryData>>()
const importPaper = vi.fn<(spaceId?: string | null) => Promise<Paper | null>>()
const analyzePaper = vi.fn<(id: string) => Promise<Paper>>()
const updatePaperMetadata = vi.fn<(id: string, metadata: PaperMetadataInput) => Promise<Paper>>()
const readPaper = vi.fn<(path: string) => Promise<Uint8Array>>()

const METADATA: PaperMetadata = {
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  venue: 'NeurIPS',
  venueType: 'conference',
  year: 2017,
  doi: '10.5555/ABC.123',
  keywords: ['transformer'],
  source: 'mixed',
  analyzedAt: 1
}

const configureAi = (autoAnalyze = true): void => {
  useSettingsStore().$patch({
    settings: {
      theme: 'light',
      language: 'zh',
      ai: {
        profiles: [
          {
            id: 'a',
            provider: 'openai',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-test',
            hasApiKey: true,
            enabled: true
          }
        ],
        activeId: 'a'
      },
      library: { directory: '', autoAnalyze },
      keyStorage: 'encrypted'
    }
  })
}

const SPACE: Space = { id: 'space-ml', name: '机器学习', createdAt: 1 }
const NLP_SPACE: Space = { id: 'space-nlp', name: '自然语言处理', createdAt: 2 }
const EMPTY: LibraryData = { spaces: [], papers: [] }

const paper = (overrides: Partial<Paper> & Pick<Paper, 'id' | 'title'>): Paper => ({
  path: `/tmp/${overrides.id}.pdf`,
  fileName: `${overrides.id}.pdf`,
  spaceId: null,
  titleSource: 'user',
  createdAt: 1,
  ...overrides
})

const installApi = (): void => {
  window.api = {
    listPapers,
    createSpace,
    renameSpace,
    deleteSpace,
    renamePaper,
    movePaper,
    setPaperFavorite,
    removePaper,
    importPaper,
    analyzePaper,
    updatePaperMetadata,
    readPaper
  } as unknown as Api
}

let pinia: ReturnType<typeof createPinia>

const mountPanel = (searchQuery?: string, expanded = false): VueWrapper =>
  mount(LibraryPanel, {
    props: { width: 280, expanded, searchQuery },
    global: { plugins: [pinia] }
  })

const buttonByText = (wrapper: VueWrapper, text: string): DOMWrapper<Element> | undefined =>
  wrapper.findAll('button').find((button) => button.text().trim() === text)

const clickButton = async (wrapper: VueWrapper, text: string): Promise<void> => {
  const button = buttonByText(wrapper, text)
  if (!button) throw new Error(`button "${text}" not found`)
  await button.trigger('click')
}

describe('LibraryPanel', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    listPapers.mockReset()
    createSpace.mockReset()
    renameSpace.mockReset()
    deleteSpace.mockReset()
    renamePaper.mockReset()
    movePaper.mockReset()
    setPaperFavorite.mockReset()
    removePaper.mockReset()
    importPaper.mockReset()
    analyzePaper.mockReset()
    updatePaperMetadata.mockReset()
    readPaper.mockReset()
    readPdfTitleMock.mockReset()

    listPapers.mockResolvedValue(EMPTY)
    readPdfTitleMock.mockResolvedValue(null)
    readPaper.mockRejectedValue(new Error('not needed'))
    installApi()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fills the available width when expanded', async () => {
    const wrapper = mountPanel(undefined, true)
    await flushPromises()

    expect(wrapper.classes()).toContain('flex-1')
    expect(wrapper.attributes('style')).toBeUndefined()
  })

  it('uses the configured width when not expanded', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.classes()).not.toContain('flex-1')
    expect(wrapper.attributes('style')).toContain('width: 280px')
  })

  it('opens a paper only after the double-click window in expanded mode', async () => {
    const target = paper({ id: 'paper-1', title: 'Paper A' })
    listPapers.mockResolvedValue({ spaces: [], papers: [target] })

    const wrapper = mountPanel(undefined, true)
    await flushPromises()

    vi.useFakeTimers()
    await clickButton(wrapper, 'Paper A')
    // 展开态单击会收起论文库；先等过双击窗口，避免双击改名的第二下丢失
    expect(wrapper.emitted('selectPaper')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.emitted('selectPaper')?.[0]).toEqual([target])
  })

  it('keeps double-click rename working in expanded mode', async () => {
    const target = paper({ id: 'paper-1', title: 'Paper A' })
    listPapers.mockResolvedValue({ spaces: [], papers: [target] })

    const wrapper = mountPanel(undefined, true)
    await flushPromises()

    vi.useFakeTimers()
    const button = buttonByText(wrapper, 'Paper A')
    if (!button) throw new Error('button "Paper A" not found')
    await button.trigger('click')
    await button.trigger('dblclick')
    await vi.advanceTimersByTimeAsync(300)

    expect(wrapper.emitted('selectPaper')).toBeUndefined()
    const input = wrapper.get('input[data-inline-input]').element as HTMLInputElement
    expect(input.value).toBe('Paper A')
  })

  it('groups papers by space and keeps unassigned papers under 未分类', async () => {
    listPapers.mockResolvedValue({
      spaces: [SPACE],
      papers: [
        paper({ id: 'paper-1', title: 'Paper A', spaceId: SPACE.id }),
        paper({ id: 'paper-2', title: 'Paper B' })
      ]
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.text()).toContain('机器学习')
    expect(wrapper.text()).toContain('未分类')
    expect(wrapper.text()).toContain('Paper A')
    expect(wrapper.text()).toContain('Paper B')
    expect(wrapper.find('button[aria-label="机器学习 操作"]').exists()).toBe(true)
  })

  it('puts favorite papers on top of their space', async () => {
    listPapers.mockResolvedValue({
      spaces: [SPACE],
      papers: [
        paper({ id: 'space-normal', title: 'Space Normal', spaceId: SPACE.id }),
        paper({ id: 'space-favorite', title: 'Space Favorite', spaceId: SPACE.id, favorite: true }),
        paper({ id: 'normal', title: 'Normal Paper' }),
        paper({ id: 'favorite', title: 'Favorite Paper', favorite: true })
      ]
    })

    const wrapper = mountPanel()
    await flushPromises()

    const titles = wrapper
      .findAll('[data-slot="sidebar-menu-button"]')
      .map((button) => button.text().trim())
    expect(titles).toEqual(['Space Favorite', 'Space Normal', 'Favorite Paper', 'Normal Paper'])
  })

  it('shows a tooltip on the favorite button', async () => {
    listPapers.mockResolvedValue({
      spaces: [],
      papers: [paper({ id: 'paper-1', title: 'Paper A' })]
    })

    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('button[aria-label="收藏 Paper A"]').trigger('focus')
    await flushPromises()

    // reka-ui 的 tooltip 内容会 Teleport 到 body；只显示操作名，不带论文名
    const tooltip = document.body.querySelector('[role="tooltip"]')
    expect(tooltip?.textContent?.trim()).toBe('收藏')
  })

  it('toggles a favorite from the row button and re-sorts the space', async () => {
    const first = paper({ id: 'paper-1', title: 'Paper A' })
    const second = paper({ id: 'paper-2', title: 'Paper B' })
    listPapers.mockResolvedValue({ spaces: [], papers: [first, second] })
    setPaperFavorite.mockResolvedValue({
      spaces: [],
      papers: [first, { ...second, favorite: true }]
    })

    const wrapper = mountPanel()
    await flushPromises()

    const favoriteButton = wrapper.get('button[aria-label="收藏 Paper B"]')
    expect(favoriteButton.attributes('aria-pressed')).toBe('false')
    await favoriteButton.trigger('click')
    await flushPromises()

    expect(setPaperFavorite).toHaveBeenCalledWith('paper-2', true)
    // 点收藏不应同时打开论文
    expect(wrapper.emitted('selectPaper')).toBeUndefined()
    const titles = wrapper
      .findAll('[data-slot="sidebar-menu-button"]')
      .map((button) => button.text().trim())
    expect(titles).toEqual(['Paper B', 'Paper A'])
    expect(wrapper.get('button[aria-label="取消收藏 Paper B"]').attributes('aria-pressed')).toBe(
      'true'
    )
  })

  it('keeps the order when toggling a favorite fails', async () => {
    const first = paper({ id: 'paper-1', title: 'Paper A' })
    const second = paper({ id: 'paper-2', title: 'Paper B' })
    listPapers.mockResolvedValue({ spaces: [], papers: [first, second] })
    setPaperFavorite.mockRejectedValue(new Error('写入失败'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('button[aria-label="收藏 Paper B"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('button[aria-label="收藏 Paper B"]').exists()).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('emits selectPaper when a paper is clicked', async () => {
    const target = paper({ id: 'paper-1', title: 'Paper A' })
    listPapers.mockResolvedValue({ spaces: [], papers: [target] })

    const wrapper = mountPanel()
    await flushPromises()
    await clickButton(wrapper, 'Paper A')

    expect(wrapper.emitted('selectPaper')?.[0]).toEqual([target])
  })

  it('filters papers by title or file name and hides empty spaces', async () => {
    const attention = paper({
      id: 'paper-1',
      title: 'Attention Is All You Need',
      fileName: '1706.03762.pdf',
      spaceId: SPACE.id
    })
    const bert = paper({
      id: 'paper-2',
      title: 'BERT',
      fileName: 'bert-pretraining.pdf',
      spaceId: NLP_SPACE.id
    })
    listPapers.mockResolvedValue({ spaces: [SPACE, NLP_SPACE], papers: [attention, bert] })

    const wrapper = mountPanel('attention')
    await flushPromises()

    expect(wrapper.text()).toContain('Attention Is All You Need')
    expect(wrapper.text()).not.toContain('BERT')
    expect(wrapper.text()).not.toContain('自然语言处理')

    await wrapper.setProps({ searchQuery: 'bert-pretraining' })
    expect(wrapper.text()).toContain('BERT')
    expect(wrapper.text()).not.toContain('Attention Is All You Need')
    expect(wrapper.text()).not.toContain('机器学习')

    await clickButton(wrapper, 'BERT')
    expect(wrapper.emitted('selectPaper')?.[0]).toEqual([bert])
  })

  it('shows the no-results state for a query without matches', async () => {
    listPapers.mockResolvedValue({
      spaces: [SPACE],
      papers: [paper({ id: 'paper-1', title: 'Attention Is All You Need', spaceId: SPACE.id })]
    })

    const wrapper = mountPanel('quantum')
    await flushPromises()

    expect(wrapper.text()).toContain('没有匹配“quantum”的论文')

    await wrapper.setProps({ searchQuery: '' })
    expect(wrapper.text()).toContain('Attention Is All You Need')
  })

  it('expands collapsed spaces while searching', async () => {
    const target = paper({ id: 'paper-1', title: 'Paper A', spaceId: SPACE.id })
    listPapers.mockResolvedValue({ spaces: [SPACE], papers: [target] })

    const wrapper = mountPanel()
    await flushPromises()
    const spaceToggle = wrapper
      .findAll('button')
      .find((button) => button.text().includes(SPACE.name))
    if (!spaceToggle) throw new Error('space toggle not found')
    await spaceToggle.trigger('click')

    // v-show 加在分组内容容器上；jsdom 的 getComputedStyle 不会继承父级 display
    const content = wrapper.get('[data-slot="sidebar-group-content"]')
    expect(content.attributes('style')).toContain('display: none')

    await wrapper.setProps({ searchQuery: 'paper' })
    expect(content.attributes('style') ?? '').not.toContain('display: none')
  })

  it('creates a space from the inline input', async () => {
    const created: LibraryData = {
      spaces: [{ id: 'space-1', name: '深度学习', createdAt: 1 }],
      papers: []
    }
    createSpace.mockResolvedValue(created)

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('button[aria-label="新建空间"]').trigger('click')

    const input = wrapper.get('input[placeholder="空间名称"]')
    await input.setValue('深度学习')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(createSpace).toHaveBeenCalledWith('深度学习')
    expect(wrapper.text()).toContain('深度学习')
  })

  it('ignores Enter that only confirms an IME candidate', async () => {
    createSpace.mockResolvedValue({
      spaces: [{ id: 'space-1', name: '机器学习', createdAt: 1 }],
      papers: []
    })

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('button[aria-label="新建空间"]').trigger('click')

    const input = wrapper.get('input[placeholder="空间名称"]')
    await input.trigger('keydown', { key: 'Enter', isComposing: true })
    await flushPromises()

    // 组词中的 Enter 只确认候选词：不能提交空名称，也不能关掉输入框
    expect(createSpace).not.toHaveBeenCalled()
    expect(wrapper.find('input[placeholder="空间名称"]').exists()).toBe(true)

    await input.setValue('机器学习')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(createSpace).toHaveBeenCalledWith('机器学习')
  })

  it('creates a space after the IME composition ends, not on the confirming Enter', async () => {
    createSpace.mockResolvedValue({
      spaces: [{ id: 'space-1', name: '机器学习', createdAt: 1 }],
      papers: []
    })

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('button[aria-label="新建空间"]').trigger('click')

    const input = wrapper.get('input[placeholder="空间名称"]')
    await input.trigger('compositionstart')
    // 组词期间浏览器会发 input 事件，但 v-model 不应更新
    await input.setValue('机器学习')
    await input.trigger('keydown', { key: 'Enter', isComposing: true })
    await flushPromises()

    expect(createSpace).not.toHaveBeenCalled()
    expect(wrapper.find('input[placeholder="空间名称"]').exists()).toBe(true)

    // 组词结束，v-model 才拿到候选词；此时按 Enter 才是真正的提交
    await input.trigger('compositionend')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(createSpace).toHaveBeenCalledWith('机器学习')
  })

  it('keeps the input open when Escape cancels an IME candidate', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('button[aria-label="新建空间"]').trigger('click')

    const input = wrapper.get('input[placeholder="空间名称"]')
    await input.trigger('keydown', { key: 'Escape', isComposing: true })
    await flushPromises()

    expect(wrapper.find('input[placeholder="空间名称"]').exists()).toBe(true)
  })

  it('renames a paper from the inline input', async () => {
    const target = paper({ id: 'paper-1', title: 'Old Title' })
    listPapers.mockResolvedValue({ spaces: [], papers: [target] })
    renamePaper.mockResolvedValue({
      spaces: [],
      papers: [{ ...target, title: 'New Title' }]
    })

    const wrapper = mountPanel()
    await flushPromises()
    const button = buttonByText(wrapper, 'Old Title')
    if (!button) throw new Error('paper button not found')
    await button.trigger('dblclick')

    const input = wrapper.get('input[data-inline-input]')
    await input.setValue('New Title')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(renamePaper).toHaveBeenCalledWith('paper-1', 'New Title', 'user')
    expect(wrapper.text()).toContain('New Title')
  })

  it('imports a paper and appends it to the list', async () => {
    const imported = paper({ id: 'paper-9', title: 'Imported', titleSource: 'user' })
    importPaper.mockResolvedValue(imported)

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('button[aria-label="导入论文"]').trigger('click')
    await flushPromises()

    expect(importPaper).toHaveBeenCalledWith(null)
    expect(wrapper.text()).toContain('Imported')
    // 没有配置 AI 时不发起解析请求
    expect(analyzePaper).not.toHaveBeenCalled()
  })

  it('shows authors and venue from parsed metadata', async () => {
    listPapers.mockResolvedValue({
      spaces: [],
      papers: [paper({ id: 'paper-1', title: 'Attention', metadata: METADATA })]
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.text()).toContain('Ashish Vaswani, Noam Shazeer')
    expect(wrapper.text()).toContain('NeurIPS · 2017')
  })

  it('analyzes an imported paper when AI is configured', async () => {
    configureAi()
    const imported = paper({ id: 'paper-9', title: 'attention', titleSource: 'file' })
    importPaper.mockResolvedValue(imported)
    readPaper.mockRejectedValue(new Error('not needed'))
    analyzePaper.mockResolvedValue({
      ...imported,
      title: 'Attention Is All You Need',
      titleSource: 'metadata',
      metadata: METADATA
    })

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('button[aria-label="导入论文"]').trigger('click')
    await flushPromises()

    expect(analyzePaper).toHaveBeenCalledWith('paper-9')
    expect(wrapper.text()).toContain('Attention Is All You Need')
    expect(wrapper.text()).toContain('NeurIPS · 2017')
  })

  it('does not analyze automatically when the setting is off', async () => {
    configureAi(false)
    importPaper.mockResolvedValue(paper({ id: 'paper-9', title: 'Imported', titleSource: 'user' }))

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('button[aria-label="导入论文"]').trigger('click')
    await flushPromises()

    expect(analyzePaper).not.toHaveBeenCalled()
  })

  it('marks a paper when automatic analysis fails', async () => {
    configureAi()
    const imported = paper({ id: 'paper-9', title: 'Imported', titleSource: 'user' })
    importPaper.mockResolvedValue(imported)
    analyzePaper.mockRejectedValue(new Error('模型不可用'))

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('button[aria-label="导入论文"]').trigger('click')
    await flushPromises()

    const icon = wrapper.get('[aria-label="论文信息解析失败"]')
    expect(icon.attributes('title')).toBe('模型不可用')
  })

  it('backfills file-based titles from PDF metadata', async () => {
    const target = paper({ id: 'paper-1', title: 'paper-1', titleSource: 'file' })
    listPapers.mockResolvedValue({ spaces: [], papers: [target] })
    readPaper.mockResolvedValue(new Uint8Array([1, 2, 3]))
    readPdfTitleMock.mockResolvedValue('Metadata Title')
    renamePaper.mockResolvedValue({
      spaces: [],
      papers: [{ ...target, title: 'Metadata Title', titleSource: 'metadata' }]
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(readPaper).toHaveBeenCalledWith(target.path)
    expect(renamePaper).toHaveBeenCalledWith('paper-1', 'Metadata Title', 'metadata')
    expect(wrapper.text()).toContain('Metadata Title')
  })

  it('asks for AI settings instead of analyzing when no AI is configured', async () => {
    listPapers.mockResolvedValue({
      spaces: [],
      papers: [paper({ id: 'paper-1', title: 'Paper One' })]
    })
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('button[aria-label="Paper One 操作"]').trigger('click')
    await flushPromises()

    const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (element) => element.textContent?.includes('AI解析')
    )
    if (!item) throw new Error('analyze menu item not found')
    item.click()
    await flushPromises()

    expect(wrapper.emitted('requestAiSettings')).toHaveLength(1)
    expect(analyzePaper).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('asks the shell to show paper info from the context menu', async () => {
    const target = paper({ id: 'paper-1', title: 'Attention', metadata: METADATA })
    listPapers.mockResolvedValue({ spaces: [], papers: [target] })

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('button[aria-label="Attention 操作"]').trigger('click')
    await flushPromises()

    const viewItem = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (element) => element.textContent?.includes('论文信息')
    )
    if (!viewItem) throw new Error('view metadata menu item not found')
    viewItem.click()
    await flushPromises()

    expect(wrapper.emitted('showPaperInfo')?.[0]).toEqual([target])
    // 菜单不再直接打开详情弹窗，信息由右侧面板展示
    expect(document.body.querySelector('#metadata-title')).toBeNull()
  })

  it('saves manually edited metadata from the details dialog', async () => {
    const original = paper({ id: 'paper-1', title: 'Attention', metadata: METADATA })
    listPapers.mockResolvedValue({ spaces: [], papers: [original] })
    updatePaperMetadata.mockResolvedValue({
      ...original,
      metadata: {
        ...METADATA,
        doi: '10.1000/edited',
        source: 'manual',
        manualFields: ['doi']
      }
    })

    const wrapper = mountPanel()
    await flushPromises()
    // 详情弹窗由信息面板的「编辑」按钮通过外壳打开
    const api = wrapper.vm as unknown as {
      openMetadata: (paper: Paper, editing?: boolean) => void
    }
    api.openMetadata(original, true)
    await flushPromises()

    const doi = document.body.querySelector<HTMLInputElement>('#metadata-doi')
    if (!doi) throw new Error('doi input not found')
    doi.value = '10.1000/edited'
    doi.dispatchEvent(new Event('input'))
    await flushPromises()

    const form = document.body.querySelector<HTMLFormElement>('#paper-metadata-form')
    if (!form) throw new Error('metadata form not found')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(updatePaperMetadata).toHaveBeenCalledTimes(1)
    const [id, input] = updatePaperMetadata.mock.calls[0]
    expect(id).toBe('paper-1')
    expect(input.doi).toBe('10.1000/edited')
    expect(input.authors).toEqual(METADATA.authors)
    // 保存成功后回到查看模式
    expect(document.body.querySelector('#metadata-doi')).toBeNull()
    wrapper.unmount()
  })

  it('keeps the editor open and shows the error when saving fails', async () => {
    const original = paper({ id: 'paper-1', title: 'Attention', metadata: METADATA })
    listPapers.mockResolvedValue({ spaces: [], papers: [original] })
    updatePaperMetadata.mockRejectedValue(new Error('DOI 格式不正确'))

    const wrapper = mountPanel()
    await flushPromises()
    const api = wrapper.vm as unknown as {
      openMetadata: (paper: Paper, editing?: boolean) => void
    }
    api.openMetadata(original, true)
    await flushPromises()

    const form = document.body.querySelector<HTMLFormElement>('#paper-metadata-form')
    if (!form) throw new Error('metadata form not found')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(document.body.querySelector('#metadata-doi')).not.toBeNull()
    expect(document.body.textContent).toContain('DOI 格式不正确')
    wrapper.unmount()
  })

  it('shows the empty state when window.api is unavailable', async () => {
    window.api = undefined

    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.text()).toContain('暂无论文')
    expect(listPapers).not.toHaveBeenCalled()
  })
})
