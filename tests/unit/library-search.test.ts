import { describe, expect, it } from 'vitest'
import { filterPapers } from '@renderer/lib/library-search'
import type { Paper } from '@renderer/types'

const paper = (overrides: Partial<Paper> & Pick<Paper, 'id' | 'title'>): Paper => ({
  path: `/tmp/${overrides.id}.pdf`,
  fileName: `${overrides.id}.pdf`,
  spaceId: null,
  titleSource: 'user',
  createdAt: 1,
  ...overrides
})

const PAPERS: Paper[] = [
  paper({ id: 'attention', title: 'Attention Is All You Need', fileName: '1706.03762.pdf' }),
  paper({ id: 'bert', title: 'BERT', fileName: 'bert-pretraining.pdf' }),
  paper({
    id: 'metadata',
    title: 'A Paper',
    fileName: 'a-paper.pdf',
    metadata: {
      authors: ['Jane Doe', 'John Smith'],
      venue: 'International Conference on Machine Learning',
      year: 2024,
      doi: '10.1234/icml.2024',
      keywords: ['representation learning'],
      source: 'mixed',
      analyzedAt: 1
    }
  })
]

describe('filterPapers', () => {
  it('returns every paper for a blank query', () => {
    expect(filterPapers(PAPERS, '')).toEqual(PAPERS)
    expect(filterPapers(PAPERS, '   ')).toEqual(PAPERS)
  })

  it('matches titles and file names case-insensitively', () => {
    expect(filterPapers(PAPERS, 'attention').map((item) => item.id)).toEqual(['attention'])
    expect(filterPapers(PAPERS, '1706').map((item) => item.id)).toEqual(['attention'])
    expect(filterPapers(PAPERS, 'BERT-PRETRAINING').map((item) => item.id)).toEqual(['bert'])
  })

  it('trims the query and supports partial matches', () => {
    expect(filterPapers(PAPERS, '  all  ').map((item) => item.id)).toEqual(['attention'])
  })

  it('matches authors, venue, DOI, and keywords from parsed metadata', () => {
    expect(filterPapers(PAPERS, 'jane doe').map((item) => item.id)).toEqual(['metadata'])
    expect(filterPapers(PAPERS, 'machine learning').map((item) => item.id)).toEqual(['metadata'])
    expect(filterPapers(PAPERS, '10.1234').map((item) => item.id)).toEqual(['metadata'])
    expect(filterPapers(PAPERS, 'representation').map((item) => item.id)).toEqual(['metadata'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterPapers(PAPERS, 'quantum')).toEqual([])
  })
})
