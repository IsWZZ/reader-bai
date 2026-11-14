import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LibraryPanel from '@renderer/components/LibraryPanel.vue'
import { readPdfTitle } from '@renderer/lib/pdf'
import type { LibraryData, Paper, Space } from '@renderer/types'

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
const removePaper = vi.fn<(id: string) => Promise<LibraryData>>()
const importPaper = vi.fn<(spaceId?: string | null) => Promise<Paper | null>>()
const readPaper = vi.fn<(path: string) => Promise<Uint8Array>>()

const SPACE: Space = { id: 'space-ml', name: '机器学习', createdAt: 1 }
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
    removePaper,
    importPaper,
    readPaper
  } as unknown as Api
}

const mountPanel = (): VueWrapper => mount(LibraryPanel, { props: { width: 280 } })

const buttonByText = (wrapper: VueWrapper, text: string): DOMWrapper<Element> | undefined =>
  wrapper.findAll('button').find((button) => button.text().trim() === text)

const clickButton = async (wrapper: VueWrapper, text: string): Promise<void> => {
  const button = buttonByText(wrapper, text)
  if (!button) throw new Error(`button "${text}" not found`)
  await button.trigger('click')
}

describe('LibraryPanel', () => {
  beforeEach(() => {
    listPapers.mockReset()
    createSpace.mockReset()
    renameSpace.mockReset()
    deleteSpace.mockReset()
    renamePaper.mockReset()
    movePaper.mockReset()
    removePaper.mockReset()
    importPaper.mockReset()
    readPaper.mockReset()
    readPdfTitleMock.mockReset()

    listPapers.mockResolvedValue(EMPTY)
    readPdfTitleMock.mockResolvedValue(null)
    readPaper.mockRejectedValue(new Error('not needed'))
    installApi()
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

  it('emits selectPaper when a paper is clicked', async () => {
    const target = paper({ id: 'paper-1', title: 'Paper A' })
    listPapers.mockResolvedValue({ spaces: [], papers: [target] })

    const wrapper = mountPanel()
    await flushPromises()
    await clickButton(wrapper, 'Paper A')

    expect(wrapper.emitted('selectPaper')?.[0]).toEqual([target])
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

  it('shows the empty state when window.api is unavailable', async () => {
    window.api = undefined

    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.text()).toContain('暂无论文')
    expect(listPapers).not.toHaveBeenCalled()
  })
})
