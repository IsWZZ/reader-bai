import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_OPEN_PAPERS, useReadingStore } from '@renderer/store/reading'
import type { Paper } from '@renderer/types'

const paper = (id: string, title = `Paper ${id}`): Paper => ({
  id,
  title,
  path: `/papers/${id}.pdf`,
  fileName: `${id}.pdf`,
  spaceId: null,
  titleSource: 'user',
  createdAt: 1
})

describe('reading store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('opens a paper and marks it active', () => {
    const store = useReadingStore()

    store.openPaper(paper('a'))

    expect(store.papers.map((item) => item.id)).toEqual(['a'])
    expect(store.activeId).toBe('a')
    expect(store.activePaper?.title).toBe('Paper a')
  })

  it('reuses the existing tab and refreshes its metadata', () => {
    const store = useReadingStore()
    store.openPaper(paper('a'))
    store.openPaper(paper('b'))

    store.openPaper(paper('a', 'Renamed'))

    expect(store.papers.map((item) => item.id)).toEqual(['a', 'b'])
    expect(store.activeId).toBe('a')
    expect(store.papers[0]?.title).toBe('Renamed')
  })

  it(`keeps at most ${MAX_OPEN_PAPERS} papers and closes the oldest`, () => {
    const store = useReadingStore()
    for (let index = 1; index <= MAX_OPEN_PAPERS; index += 1) {
      store.openPaper(paper(String(index)))
    }

    store.openPaper(paper('newest'))

    expect(store.papers).toHaveLength(MAX_OPEN_PAPERS)
    expect(store.papers[0]?.id).toBe('2')
    expect(store.papers.at(-1)?.id).toBe('newest')
    expect(store.activeId).toBe('newest')
  })

  it('syncs updated metadata into an open tab without changing the active paper', () => {
    const store = useReadingStore()
    store.openPaper(paper('a'))
    store.openPaper(paper('b'))

    const updated: Paper = {
      ...paper('a'),
      title: 'Updated',
      metadata: { authors: ['Author'], keywords: [], source: 'manual', analyzedAt: 1 }
    }
    store.syncPaper(updated)

    expect(store.activeId).toBe('b')
    expect(store.papers[0]).toEqual(updated)

    // 未打开的论文不会凭空加入标签
    store.syncPaper(paper('missing'))
    expect(store.papers.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('activates a known tab and ignores unknown ids', () => {
    const store = useReadingStore()
    store.openPaper(paper('a'))
    store.openPaper(paper('b'))

    store.activatePaper('a')
    expect(store.activeId).toBe('a')

    store.activatePaper('missing')
    expect(store.activeId).toBe('a')
  })

  it('selects the right neighbour when closing the active tab', () => {
    const store = useReadingStore()
    store.openPaper(paper('a'))
    store.openPaper(paper('b'))
    store.openPaper(paper('c'))
    store.activatePaper('b')

    store.closePaper('b')
    expect(store.papers.map((item) => item.id)).toEqual(['a', 'c'])
    expect(store.activeId).toBe('c')

    // 右侧没有标签后回到左侧
    store.closePaper('c')
    expect(store.activeId).toBe('a')

    store.closePaper('a')
    expect(store.activeId).toBeNull()
    expect(store.activePaper).toBeNull()
  })

  it('keeps the active paper when closing another tab', () => {
    const store = useReadingStore()
    store.openPaper(paper('a'))
    store.openPaper(paper('b'))

    store.closePaper('a')

    expect(store.activeId).toBe('b')
    expect(store.papers.map((item) => item.id)).toEqual(['b'])
  })
})
