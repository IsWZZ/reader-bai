import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import PaperMetadataDialog from '@renderer/components/PaperMetadataDialog.vue'
import type { Paper, PaperMetadata } from '@renderer/types'

const metadata: PaperMetadata = {
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  venue: 'NeurIPS',
  venueType: 'conference',
  year: 2017,
  doi: '10.5555/ABC.123',
  abstract: 'The dominant sequence transduction models.',
  keywords: ['transformer', 'attention'],
  summary: 'A new sequence model.',
  source: 'mixed',
  analyzedAt: new Date('2025-06-01T00:00:00Z').getTime()
}

const paper: Paper = {
  id: 'paper-1',
  title: 'Display title',
  path: '/tmp/paper.pdf',
  fileName: 'paper.pdf',
  spaceId: null,
  titleSource: 'metadata',
  createdAt: 1,
  metadata
}

// DialogContent 会 teleport 到 body，直接从 body 查询渲染结果
const mountDialog = async (
  overrides: { paper?: Paper | null; analyzing?: boolean } = {}
): Promise<VueWrapper> => {
  const wrapper = mount(PaperMetadataDialog, {
    props: {
      paper: overrides.paper === undefined ? paper : overrides.paper,
      open: true,
      analyzing: overrides.analyzing
    }
  })
  await flushPromises()
  return wrapper
}

const bodyText = (): string => document.body.textContent ?? ''

const bodyButton = (text: string): HTMLButtonElement | undefined =>
  [...document.body.querySelectorAll('button')].find((button) =>
    (button.textContent ?? '').includes(text)
  )

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PaperMetadataDialog', () => {
  it('renders parsed bibliographic fields', async () => {
    const wrapper = await mountDialog()

    expect(bodyText()).toContain('Display title')
    expect(bodyText()).toContain('Ashish Vaswani, Noam Shazeer')
    expect(bodyText()).toContain('NeurIPS · 2017')
    expect(bodyText()).toContain('10.5555/ABC.123')
    expect(bodyText()).toContain('The dominant sequence transduction models.')
    expect(bodyText()).toContain('transformer')
    expect(bodyText()).toContain('A new sequence model.')
    expect(bodyText()).toContain('AI + Crossref')

    wrapper.unmount()
  })

  it('shows the empty state and still offers analysis', async () => {
    const wrapper = await mountDialog({ paper: { ...paper, metadata: undefined } })

    expect(bodyText()).toContain('还没有解析结果')
    expect(bodyButton('AI 解析论文信息')).toBeDefined()

    wrapper.unmount()
  })

  it('emits analyze with the current paper', async () => {
    const wrapper = await mountDialog()
    const button = bodyButton('AI 解析论文信息')
    if (!button) throw new Error('analyze button not found')

    button.click()
    await flushPromises()

    expect(wrapper.emitted('analyze')?.[0]).toEqual([paper])

    wrapper.unmount()
  })

  it('disables the button while analysis is running', async () => {
    const wrapper = await mountDialog({ analyzing: true })

    expect(bodyButton('正在解析')?.disabled).toBe(true)

    wrapper.unmount()
  })
})
