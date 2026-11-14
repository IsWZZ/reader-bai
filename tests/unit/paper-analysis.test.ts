import { describe, expect, it, vi } from 'vitest'
import { createPaperAnalyzer, type PaperAnalyzerDeps } from '../../src/main/paper-analysis'
import type { PaperMetadata } from '../../src/main/paper-metadata'
import type { StoredSettings } from '../../src/main/settings'

const NOW = new Date('2025-06-01T00:00:00Z').getTime()

const storedSettings = (withProfile = true): StoredSettings => ({
  theme: 'light',
  language: 'zh',
  ai: {
    profiles: withProfile
      ? [
          {
            id: 'a',
            provider: 'openai',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'sk-test',
            apiKeyEncrypted: false,
            model: 'gpt-test',
            enabled: true
          }
        ]
      : [],
    activeId: withProfile ? 'a' : ''
  },
  library: { directory: '', autoAnalyze: true }
})

const aiJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani'],
    venue: 'NeurIPS',
    venueType: 'conference',
    year: 2017,
    doi: '10.5555/ABC.123',
    abstract: 'The dominant models.',
    keywords: ['transformer'],
    summary: 'A new sequence model.',
    ...overrides
  })

const crossrefMetadata = (overrides: Partial<PaperMetadata> = {}): PaperMetadata => ({
  title: 'Attention is All you Need',
  authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
  venue: 'Advances in Neural Information Processing Systems',
  venueType: 'conference',
  year: 2017,
  doi: '10.5555/ABC.123',
  keywords: [],
  source: 'crossref',
  analyzedAt: NOW,
  ...overrides
})

interface Overrides {
  settings?: StoredSettings
  chat?: PaperAnalyzerDeps['requester']['chat']
  readIntroText?: PaperAnalyzerDeps['readIntroText']
  lookup?: PaperAnalyzerDeps['lookup']
}

const createDeps = (overrides: Overrides = {}): PaperAnalyzerDeps => ({
  settings: {
    read: async () => overrides.settings ?? storedSettings(),
    decodeApiKey: () => 'sk-test'
  },
  requester: {
    chat:
      overrides.chat ??
      (async () => ({
        text: aiJson(),
        toolCalls: [],
        finishReason: 'stop' as const
      }))
  },
  readIntroText: overrides.readIntroText ?? (async () => 'Paper text. DOI: 10.5555/ABC.123'),
  lookup: overrides.lookup ?? (async () => crossrefMetadata()),
  now: () => NOW
})

const paper = { id: 'paper-1', path: '/tmp/paper.pdf', title: 'attention' }

describe('createPaperAnalyzer', () => {
  it('parses AI output and merges Crossref enrichment', async () => {
    const lookup = vi.fn(async () => crossrefMetadata())
    const analyzer = createPaperAnalyzer(createDeps({ lookup }))

    const result = await analyzer.analyze(paper, { useWeb: true })

    expect(lookup).toHaveBeenCalledWith({
      doi: '10.5555/ABC.123',
      title: 'Attention Is All You Need'
    })
    expect(result).toMatchObject({
      title: 'Attention is All you Need',
      authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
      venue: 'Advances in Neural Information Processing Systems',
      summary: 'A new sequence model.',
      source: 'mixed',
      analyzedAt: NOW
    })
  })

  it('uses a DOI found in the text when the model omits it', async () => {
    const chat = vi.fn(async () => ({
      text: aiJson({ doi: null }),
      toolCalls: [],
      finishReason: 'stop' as const
    }))
    const lookup = vi.fn(async () => crossrefMetadata())
    const analyzer = createPaperAnalyzer(createDeps({ chat, lookup }))

    await analyzer.analyze(paper)

    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ doi: '10.5555/ABC.123' }))
  })

  it('falls back to Crossref when the AI request fails', async () => {
    const chat = vi.fn(async () => {
      throw new Error('network down')
    })
    const analyzer = createPaperAnalyzer(createDeps({ chat }))

    await expect(analyzer.analyze(paper)).resolves.toMatchObject({
      title: 'Attention is All you Need',
      source: 'crossref'
    })
  })

  it('skips Crossref when web lookup is disabled', async () => {
    const lookup = vi.fn(async () => crossrefMetadata())
    const analyzer = createPaperAnalyzer(createDeps({ lookup }))

    const result = await analyzer.analyze(paper, { useWeb: false })

    expect(lookup).not.toHaveBeenCalled()
    expect(result.source).toBe('ai')
  })

  it('requires a configured AI profile before reading the PDF', async () => {
    const readIntroText = vi.fn(async () => 'text')
    const lookup = vi.fn(async () => crossrefMetadata())
    const analyzer = createPaperAnalyzer(
      createDeps({ settings: storedSettings(false), readIntroText, lookup })
    )

    await expect(analyzer.analyze(paper)).rejects.toThrow('请先在设置中配置 AI 服务')
    expect(readIntroText).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('skips a disabled active profile and uses another enabled one', async () => {
    const settings = storedSettings()
    const profile = settings.ai.profiles[0]
    settings.ai.profiles = [
      { ...profile, enabled: false },
      { ...profile, id: 'b', enabled: true }
    ]
    settings.ai.activeId = 'a'
    const chat = vi.fn(async () => ({
      text: aiJson(),
      toolCalls: [],
      finishReason: 'stop' as const
    }))
    const analyzer = createPaperAnalyzer(createDeps({ settings, chat }))

    await analyzer.analyze(paper)

    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'b' }))
  })

  it('rejects when every AI profile is disabled without reading the PDF', async () => {
    const settings = storedSettings()
    settings.ai.profiles = settings.ai.profiles.map((profile) => ({
      ...profile,
      enabled: false
    }))
    const readIntroText = vi.fn(async () => 'text')
    const analyzer = createPaperAnalyzer(createDeps({ settings, readIntroText }))

    await expect(analyzer.analyze(paper)).rejects.toThrow('所有 AI 配置都已禁用')
    expect(readIntroText).not.toHaveBeenCalled()
  })

  it('rejects unreadable PDFs with a readable error', async () => {
    const analyzer = createPaperAnalyzer(
      createDeps({
        readIntroText: async () => {
          throw new Error('ENOENT')
        }
      })
    )

    await expect(analyzer.analyze(paper)).rejects.toThrow('读取论文文本失败')
  })

  it('rejects empty PDF text', async () => {
    const analyzer = createPaperAnalyzer(createDeps({ readIntroText: async () => '   ' }))

    await expect(analyzer.analyze(paper)).rejects.toThrow('可能是扫描版论文')
  })

  it('reports the AI failure when neither AI nor Crossref finds data', async () => {
    const chat = vi.fn(async () => {
      throw new Error('network down')
    })
    const analyzer = createPaperAnalyzer(createDeps({ chat, lookup: async () => null }))

    await expect(analyzer.analyze(paper)).rejects.toThrow('AI 解析失败：network down')
  })

  it('deduplicates concurrent analysis of the same paper', async () => {
    const chat = vi.fn(async () => ({
      text: aiJson(),
      toolCalls: [],
      finishReason: 'stop' as const
    }))
    const analyzer = createPaperAnalyzer(createDeps({ chat }))

    const [first, second] = await Promise.all([analyzer.analyze(paper), analyzer.analyze(paper)])

    expect(chat).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
  })
})
