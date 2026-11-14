import { describe, expect, it } from 'vitest'
import {
  buildMetadataMessages,
  extractDoiFromText,
  mergePaperMetadata,
  normalizeDoi,
  normalizePaperMetadata,
  parseMetadataResponse,
  type PaperMetadata
} from '../../src/main/paper-metadata'

const NOW = new Date('2025-06-01T00:00:00Z').getTime()

const aiMetadata = (overrides: Partial<PaperMetadata> = {}): PaperMetadata => ({
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani'],
  venue: 'NeurIPS',
  venueType: 'conference',
  year: 2017,
  doi: '10.5555/3295222.3295349',
  abstract: 'The dominant sequence transduction models...',
  keywords: ['transformer'],
  summary: 'A new sequence model.',
  source: 'ai',
  analyzedAt: NOW,
  ...overrides
})

describe('normalizeDoi', () => {
  it('accepts plain and URL forms and strips trailing punctuation', () => {
    expect(normalizeDoi('10.1000/ABC.123')).toBe('10.1000/ABC.123')
    expect(normalizeDoi('https://doi.org/10.1000/abc')).toBe('10.1000/abc')
    expect(normalizeDoi('https://dx.doi.org/10.1000/abc.')).toBe('10.1000/abc')
    expect(normalizeDoi('doi: 10.1000/abc;')).toBe('10.1000/abc')
    expect(normalizeDoi('10.1000/abc).')).toBe('10.1000/abc')
    expect(normalizeDoi('10.1000/abc(1)')).toBe('10.1000/abc(1)')
  })

  it('rejects invalid, oversized, and non-string values', () => {
    expect(normalizeDoi('not-a-doi')).toBeUndefined()
    expect(normalizeDoi(`10.1000/${'a'.repeat(400)}`)).toBeUndefined()
    expect(normalizeDoi(42)).toBeUndefined()
  })
})

describe('extractDoiFromText', () => {
  it('finds the first DOI in paper text', () => {
    const text = 'Published online. DOI: 10.1145/3292500.3330701, then more text.'
    expect(extractDoiFromText(text)).toBe('10.1145/3292500.3330701')
  })

  it('returns undefined when there is no DOI', () => {
    expect(extractDoiFromText('No identifier here')).toBeUndefined()
  })
})

describe('normalizePaperMetadata', () => {
  it('keeps valid fields and drops invalid years, sources, and empty values', () => {
    const metadata = normalizePaperMetadata(
      {
        title: '  Paper title  ',
        authors: ['Alice', 'Alice', '', 'Bob'],
        venue: 'Journal',
        venueType: 'magazine',
        year: '2019',
        doi: '10.1000/xyz',
        abstract: '  Abstract  ',
        keywords: ['ai', 'ai', 'ml'],
        summary: 'Short summary.',
        source: 'unknown',
        analyzedAt: 123
      },
      'ai',
      NOW
    )

    expect(metadata).toMatchObject({
      title: 'Paper title',
      authors: ['Alice', 'Bob'],
      venue: 'Journal',
      year: 2019,
      doi: '10.1000/xyz',
      abstract: 'Abstract',
      keywords: ['ai', 'ml'],
      summary: 'Short summary.',
      source: 'ai',
      analyzedAt: 123
    })
    expect(metadata?.venueType).toBeUndefined()
  })

  it('rejects out-of-range years and non-object input', () => {
    expect(normalizePaperMetadata({ year: 1200 }, 'ai', NOW)).toBeNull()
    expect(normalizePaperMetadata({ year: 9999 }, 'ai', NOW)).toBeNull()
    expect(normalizePaperMetadata('broken', 'ai', NOW)).toBeNull()
  })

  it('returns null when no meaningful field is present', () => {
    expect(normalizePaperMetadata({}, 'ai', NOW)).toBeNull()
    expect(normalizePaperMetadata({ authors: [], keywords: [] }, 'ai', NOW)).toBeNull()
  })
})

describe('parseMetadataResponse', () => {
  it('parses JSON wrapped in a Markdown code fence', () => {
    const text = 'Here is the result:\n```json\n{"title":"Paper","authors":["A"]}\n```'
    expect(parseMetadataResponse(text, NOW)).toMatchObject({
      title: 'Paper',
      authors: ['A'],
      source: 'ai',
      analyzedAt: NOW
    })
  })

  it('parses a bare JSON object', () => {
    expect(parseMetadataResponse('{"doi":"10.1000/abc"}', NOW)).toMatchObject({
      doi: '10.1000/abc'
    })
  })

  it('returns null for non-JSON or empty responses', () => {
    expect(parseMetadataResponse('I could not read the paper.', NOW)).toBeNull()
    expect(parseMetadataResponse('', NOW)).toBeNull()
    expect(parseMetadataResponse('{broken json}', NOW)).toBeNull()
  })
})

describe('mergePaperMetadata', () => {
  it('prefers Crossref bibliographic fields and keeps AI enrichment', () => {
    const crossref = aiMetadata({
      title: 'Attention is All you Need',
      authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
      venue: 'Advances in Neural Information Processing Systems',
      year: 2017,
      abstract: undefined,
      keywords: [],
      summary: undefined,
      source: 'crossref'
    })

    expect(mergePaperMetadata(aiMetadata(), crossref, NOW)).toEqual({
      title: 'Attention is All you Need',
      authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
      venue: 'Advances in Neural Information Processing Systems',
      venueType: 'conference',
      year: 2017,
      doi: '10.5555/3295222.3295349',
      abstract: 'The dominant sequence transduction models...',
      keywords: ['transformer'],
      summary: 'A new sequence model.',
      source: 'mixed',
      analyzedAt: NOW
    })
  })

  it('returns whichever side exists and stamps the analysis time', () => {
    expect(mergePaperMetadata(aiMetadata({ analyzedAt: 1 }), null, NOW)).toMatchObject({
      source: 'ai',
      analyzedAt: NOW
    })
    expect(
      mergePaperMetadata(null, aiMetadata({ source: 'crossref', analyzedAt: 1 }), NOW)
    ).toMatchObject({
      source: 'crossref',
      analyzedAt: NOW
    })
    expect(mergePaperMetadata(null, null, NOW)).toBeNull()
  })
})

describe('buildMetadataMessages', () => {
  it('sends a JSON-only system prompt plus the paper text', () => {
    const messages = buildMetadataMessages('Paper text')

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('Return one JSON object')
    expect(messages[1]).toEqual({
      role: 'user',
      content: 'Extract the metadata from these paper pages:\n\nPaper text'
    })
  })
})
