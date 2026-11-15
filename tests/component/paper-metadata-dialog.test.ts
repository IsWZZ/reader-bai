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
  overrides: {
    paper?: Paper | null
    editing?: boolean
    analyzing?: boolean
    saving?: boolean
    saveError?: string | null
  } = {}
): Promise<VueWrapper> => {
  const wrapper = mount(PaperMetadataDialog, {
    props: {
      paper: overrides.paper === undefined ? paper : overrides.paper,
      open: true,
      editing: overrides.editing,
      analyzing: overrides.analyzing,
      saving: overrides.saving,
      saveError: overrides.saveError
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

const control = (id: string): HTMLInputElement | HTMLTextAreaElement => {
  const element = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)
  if (!element) throw new Error(`${id} not found`)
  return element
}

const setControl = async (id: string, value: string): Promise<void> => {
  const element = control(id)
  element.value = value
  element.dispatchEvent(new Event('input'))
  await flushPromises()
}

const submitForm = (): void => {
  const form = document.body.querySelector<HTMLFormElement>('#paper-metadata-form')
  if (!form) throw new Error('metadata form not found')
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

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

  it('shows the empty state and still offers analysis and manual editing', async () => {
    const wrapper = await mountDialog({ paper: { ...paper, metadata: undefined } })

    expect(bodyText()).toContain('还没有论文信息')
    expect(bodyButton('AI解析')).toBeDefined()
    expect(bodyButton('编辑')).toBeDefined()

    wrapper.unmount()
  })

  it('emits analyze with the current paper', async () => {
    const wrapper = await mountDialog()
    const button = bodyButton('AI解析')
    if (!button) throw new Error('analyze button not found')

    button.click()
    await flushPromises()

    expect(wrapper.emitted('analyze')?.[0]).toEqual([paper])

    wrapper.unmount()
  })

  it('requests edit mode from the edit button', async () => {
    const wrapper = await mountDialog()
    const button = bodyButton('编辑')
    if (!button) throw new Error('edit button not found')

    button.click()
    await flushPromises()

    expect(wrapper.emitted('update:editing')?.[0]).toEqual([true])

    wrapper.unmount()
  })

  it('disables the button while analysis is running', async () => {
    const wrapper = await mountDialog({ analyzing: true })

    expect(bodyButton('正在解析')?.disabled).toBe(true)

    wrapper.unmount()
  })

  it('enters edit mode and prefills the current metadata', async () => {
    const wrapper = await mountDialog({ editing: true })

    expect(control('metadata-title').value).toBe('Attention Is All You Need')
    expect(control('metadata-authors').value).toBe('Ashish Vaswani\nNoam Shazeer')
    expect(control('metadata-venue').value).toBe('NeurIPS')
    expect(control('metadata-year').value).toBe('2017')
    expect(control('metadata-doi').value).toBe('10.5555/ABC.123')
    expect(control('metadata-keywords').value).toBe('transformer, attention')

    wrapper.unmount()
  })

  it('emits save with cleaned manual metadata', async () => {
    const wrapper = await mountDialog({ editing: true })

    await setControl('metadata-authors', 'Ada Lovelace\n\nAlan Turing')
    await setControl('metadata-keywords', 'nlp, agents')
    await setControl('metadata-year', '2020')
    await setControl('metadata-doi', ' 10.1000/XYZ ')
    submitForm()

    expect(wrapper.emitted('save')?.[0]).toEqual([
      paper,
      {
        title: 'Attention Is All You Need',
        authors: ['Ada Lovelace', 'Alan Turing'],
        venue: 'NeurIPS',
        venueType: 'conference',
        year: '2020',
        doi: '10.1000/XYZ',
        abstract: 'The dominant sequence transduction models.',
        keywords: ['nlp', 'agents'],
        summary: 'A new sequence model.'
      }
    ])

    wrapper.unmount()
  })

  it('reports save progress and errors', async () => {
    const wrapper = await mountDialog({
      editing: true,
      saving: true,
      saveError: 'DOI 格式不正确'
    })

    expect(bodyText()).toContain('DOI 格式不正确')
    expect(bodyButton('保存中')?.disabled).toBe(true)

    wrapper.unmount()
  })

  it('labels manually saved metadata', async () => {
    const wrapper = await mountDialog({
      paper: { ...paper, metadata: { ...metadata, source: 'manual' } }
    })

    expect(bodyText()).toContain('手动填写')

    wrapper.unmount()
  })
})
