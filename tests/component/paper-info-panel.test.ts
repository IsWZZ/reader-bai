import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PaperInfoPanel from '@renderer/components/PaperInfoPanel.vue'
import type { Paper, PaperMetadata } from '@renderer/types'

const METADATA: PaperMetadata = {
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  venue: 'NeurIPS',
  venueType: 'conference',
  year: 2017,
  doi: '10.5555/ABC.123',
  abstract: 'An abstract parsed from the paper.',
  keywords: ['transformer', 'attention'],
  summary: 'A short AI summary.',
  source: 'manual',
  analyzedAt: 1
}

const PAPER: Paper = {
  id: 'paper-1',
  title: 'Attention Is All You Need',
  path: '/papers/paper-1.pdf',
  fileName: '1706.03762.pdf',
  spaceId: null,
  titleSource: 'user',
  createdAt: 1,
  metadata: METADATA
}

describe('PaperInfoPanel', () => {
  it('asks the user to open a paper when nothing is active', () => {
    const wrapper = mount(PaperInfoPanel, { props: { paper: null } })

    expect(wrapper.text()).toContain('打开论文后在这里查看论文信息')
  })

  it('shows the active paper and its metadata', () => {
    const wrapper = mount(PaperInfoPanel, { props: { paper: PAPER } })

    const text = wrapper.text()
    expect(text).toContain('Attention Is All You Need')
    expect(text).toContain('1706.03762.pdf')
    expect(text).toContain('Ashish Vaswani, Noam Shazeer')
    expect(text).toContain('NeurIPS · 2017')
    expect(text).toContain('10.5555/ABC.123')
    expect(text).toContain('A short AI summary.')
    expect(text).toContain('An abstract parsed from the paper.')
    expect(text).toContain('transformer')
    expect(text).toContain('手动填写')
  })

  it('points to the library when the paper has no metadata yet', () => {
    const wrapper = mount(PaperInfoPanel, {
      props: { paper: { ...PAPER, metadata: undefined } }
    })

    expect(wrapper.text()).toContain('还没有论文信息')
  })
})
