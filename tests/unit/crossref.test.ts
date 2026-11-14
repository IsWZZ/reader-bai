import { describe, expect, it, vi } from 'vitest'
import {
  lookupCrossref,
  mapCrossrefWork,
  titleSimilarity,
  type FetchLike
} from '../../src/main/crossref'

const NOW = new Date('2025-06-01T00:00:00Z').getTime()

const response = (payload: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })

const work = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  DOI: '10.5555/ABC.123',
  title: ['Attention Is All You Need'],
  author: [
    { given: 'Ashish', family: 'Vaswani' },
    { literal: 'The Team' },
    { given: 'Noam', family: 'Shazeer' }
  ],
  'container-title': ['Advances in Neural Information Processing Systems'],
  issued: { 'date-parts': [[2017, 12, 4]] },
  type: 'proceedings-article',
  abstract: '<jats:p>The <jats:italic>dominant</jats:italic> models &amp; more.</jats:p>',
  subject: ['Machine Learning', 'Transformers'],
  ...overrides
})

describe('titleSimilarity', () => {
  it('scores identical titles as 1 and ignores case and punctuation', () => {
    expect(titleSimilarity('Attention Is All You Need', 'attention is all you need!')).toBe(1)
  })

  it('penalizes reordered titles and still accepts a subtitle', () => {
    expect(titleSimilarity('Attention Is All You Need', 'Is Attention All You Need?')).toBeLessThan(
      0.8
    )
    expect(
      titleSimilarity('Attention Is All You Need', 'Attention Is All You Need: A Survey')
    ).toBeGreaterThan(0.8)
  })

  it('rejects unrelated titles', () => {
    expect(titleSimilarity('Attention Is All You Need', 'Quantum Gravity')).toBe(0)
  })
})

describe('mapCrossrefWork', () => {
  it('maps authors, venue, year, DOI, abstract, and keywords', () => {
    expect(mapCrossrefWork(work(), NOW)).toEqual({
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      venue: 'Advances in Neural Information Processing Systems',
      venueType: 'conference',
      year: 2017,
      doi: '10.5555/ABC.123',
      abstract: 'The dominant models & more.',
      keywords: ['Machine Learning', 'Transformers'],
      source: 'crossref',
      analyzedAt: NOW
    })
  })

  it('maps journal and preprint types', () => {
    expect(mapCrossrefWork(work({ type: 'journal-article' }), NOW)?.venueType).toBe('journal')
    expect(mapCrossrefWork(work({ type: 'posted-content' }), NOW)?.venueType).toBe('preprint')
    expect(mapCrossrefWork(work({ type: 'dataset' }), NOW)?.venueType).toBe('other')
  })

  it('returns null for empty or invalid entries', () => {
    expect(mapCrossrefWork(null, NOW)).toBeNull()
    expect(mapCrossrefWork({}, NOW)).toBeNull()
  })
})

describe('lookupCrossref', () => {
  it('looks up a DOI with the encoded works URL', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => response({ message: work() }))

    const result = await lookupCrossref({
      doi: 'https://doi.org/10.5555/ABC.123',
      title: 'Ignored',
      fetch: fetchMock,
      now: NOW
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.crossref.org/works/10.5555%2FABC.123')
    expect(init?.headers).toMatchObject({ Accept: 'application/json' })
    expect(result).toMatchObject({ doi: '10.5555/ABC.123', source: 'crossref' })
  })

  it('searches by title and picks the most similar result', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      response({
        message: {
          items: [
            work({ DOI: '10.1234/wrong', title: ['Quantum Gravity'] }),
            work({ DOI: '10.1234/right', title: ['Attention Is All You Need'] })
          ]
        }
      })
    )

    const result = await lookupCrossref({
      title: 'Attention is all you need',
      fetch: fetchMock,
      now: NOW
    })

    expect(result?.doi).toBe('10.1234/right')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('query.bibliographic=Attention+is+all+you+need')
    expect(url).toContain('rows=5')
  })

  it('does not accept a title result below the similarity threshold', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      response({ message: { items: [work({ title: ['A Completely Different Paper'] })] } })
    )

    await expect(
      lookupCrossref({ title: 'Attention Is All You Need', fetch: fetchMock, now: NOW })
    ).resolves.toBeNull()
  })

  it('skips short titles without making a request', async () => {
    const fetchMock = vi.fn<FetchLike>()

    await expect(lookupCrossref({ title: 'BERT', fetch: fetchMock })).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null on HTTP errors, invalid JSON, and network failures', async () => {
    const failing = vi.fn<FetchLike>(async () => new Response('nope', { status: 500 }))
    await expect(lookupCrossref({ doi: '10.1/x', fetch: failing, now: NOW })).resolves.toBeNull()

    const invalid = vi.fn<FetchLike>(async () => new Response('not json', { status: 200 }))
    await expect(lookupCrossref({ doi: '10.1/x', fetch: invalid, now: NOW })).resolves.toBeNull()

    const rejected = vi.fn<FetchLike>(async () => {
      throw new Error('offline')
    })
    await expect(lookupCrossref({ doi: '10.1/x', fetch: rejected, now: NOW })).resolves.toBeNull()
  })

  it('rejects oversized responses', async () => {
    const fetchMock = vi.fn<FetchLike>(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': '9999999' }
        })
    )

    await expect(lookupCrossref({ doi: '10.1/x', fetch: fetchMock, now: NOW })).resolves.toBeNull()
  })
})
