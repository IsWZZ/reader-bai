// 论文元数据的清洗、模型输出解析与合并。
// 这里的逻辑不依赖 electron 或网络，方便直接做单元测试。

import type { ChatMessage } from './ai'

export type PaperVenueType = 'journal' | 'conference' | 'preprint' | 'book' | 'other'
export type PaperMetadataSource = 'ai' | 'crossref' | 'mixed'

export interface PaperMetadata {
  title?: string
  authors: string[]
  venue?: string
  venueType?: PaperVenueType
  year?: number
  doi?: string
  abstract?: string
  keywords: string[]
  /** AI 生成的一段简短概括，不替代原文摘要 */
  summary?: string
  source: PaperMetadataSource
  analyzedAt: number
}

const MAX_TITLE = 300
const MAX_AUTHOR = 120
const MAX_AUTHORS = 40
const MAX_VENUE = 300
const MAX_DOI = 300
const MAX_ABSTRACT = 5000
const MAX_KEYWORD = 80
const MAX_KEYWORDS = 20
const MAX_SUMMARY = 1500
const MIN_YEAR = 1800
const MAX_YEAR_OFFSET = 1

const VENUE_TYPES = new Set<PaperVenueType>(['journal', 'conference', 'preprint', 'book', 'other'])
const METADATA_SOURCES = new Set<PaperMetadataSource>(['ai', 'crossref', 'mixed'])

// DOI 只允许字面上的 10.xxxx/... 形式；不接受空白，避免把任意字符串拼进 URL
const DOI_PATTERN = /^10\.\d{4,9}\/[^\s]+$/i
const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"'<>]+/i

const asString = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const asStringArray = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    const text = asString(item, maxLength)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

/** 去掉 doi.org 前缀和句末标点，只保留合法 DOI */
export const normalizeDoi = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  let trimmed = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;:]+$/, '')

  // 正文里常见的 “(DOI: 10.x/y)” 会带上不配对的右括号；
  // 保留 DOI 本身合法的括号，只去掉没有对应左括号的尾部符号。
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
    ['{', '}']
  ] as const) {
    if (!trimmed.endsWith(close)) continue
    const opens = trimmed.split(open).length - 1
    const closes = trimmed.split(close).length - 1
    if (opens < closes) trimmed = trimmed.slice(0, -1).replace(/[.,;:]+$/, '')
  }

  if (trimmed.length > MAX_DOI) return undefined
  return DOI_PATTERN.test(trimmed) ? trimmed : undefined
}

/** 从论文首页文本中找 DOI，作为模型未返回 DOI 时的兜底 */
export const extractDoiFromText = (text: string): string | undefined => {
  const match = text.match(DOI_IN_TEXT)
  return match ? normalizeDoi(match[0]) : undefined
}

const normalizeYear = (value: unknown, now: number): number | undefined => {
  const year =
    typeof value === 'number'
      ? Math.trunc(value)
      : typeof value === 'string' && /^\d{4}$/.test(value.trim())
        ? Number(value.trim())
        : NaN
  const maxYear = new Date(now).getFullYear() + MAX_YEAR_OFFSET
  return Number.isFinite(year) && year >= MIN_YEAR && year <= maxYear ? year : undefined
}

const normalizeVenueType = (value: unknown): PaperVenueType | undefined =>
  typeof value === 'string' && VENUE_TYPES.has(value as PaperVenueType)
    ? (value as PaperVenueType)
    : undefined

const normalizeSource = (value: unknown, fallback: PaperMetadataSource): PaperMetadataSource =>
  typeof value === 'string' && METADATA_SOURCES.has(value as PaperMetadataSource)
    ? (value as PaperMetadataSource)
    : fallback

/** 校验一份元数据；没有任何有效字段时返回 null */
export const normalizePaperMetadata = (
  raw: unknown,
  fallbackSource: PaperMetadataSource = 'ai',
  now: number = Date.now()
): PaperMetadata | null => {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>

  const metadata: PaperMetadata = {
    authors: asStringArray(item.authors, MAX_AUTHORS, MAX_AUTHOR),
    keywords: asStringArray(item.keywords, MAX_KEYWORDS, MAX_KEYWORD),
    source: normalizeSource(item.source, fallbackSource),
    analyzedAt:
      typeof item.analyzedAt === 'number' && Number.isFinite(item.analyzedAt) && item.analyzedAt > 0
        ? item.analyzedAt
        : now
  }

  const title = asString(item.title, MAX_TITLE)
  if (title) metadata.title = title
  const venue = asString(item.venue, MAX_VENUE)
  if (venue) metadata.venue = venue
  const venueType = normalizeVenueType(item.venueType)
  if (venueType) metadata.venueType = venueType
  const year = normalizeYear(item.year, now)
  if (year) metadata.year = year
  const doi = normalizeDoi(item.doi)
  if (doi) metadata.doi = doi
  const abstract = asString(item.abstract, MAX_ABSTRACT)
  if (abstract) metadata.abstract = abstract
  const summary = asString(item.summary, MAX_SUMMARY)
  if (summary) metadata.summary = summary

  const meaningful =
    metadata.title ||
    metadata.authors.length > 0 ||
    metadata.venue ||
    metadata.year ||
    metadata.doi ||
    metadata.abstract ||
    metadata.keywords.length > 0 ||
    metadata.summary

  return meaningful ? metadata : null
}

/**
 * 模型被要求只输出 JSON，但仍可能包在代码块或说明文字里。
 * 这里只取最外层对象，解析失败返回 null，交给调用方决定是否降级。
 */
export const parseMetadataResponse = (
  text: string,
  now: number = Date.now()
): PaperMetadata | null => {
  if (typeof text !== 'string' || !text.trim()) return null
  const unwrapped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = unwrapped.indexOf('{')
  const end = unwrapped.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  try {
    return normalizePaperMetadata(JSON.parse(unwrapped.slice(start, end + 1)), 'ai', now)
  } catch {
    return null
  }
}

/**
 * 合并模型抽取和 Crossref 结果。
 * Crossref 是书目数据的权威来源，优先采用；模型补充摘要、关键词和概括。
 */
export const mergePaperMetadata = (
  ai: PaperMetadata | null,
  crossref: PaperMetadata | null,
  now: number = Date.now()
): PaperMetadata | null => {
  if (!ai && !crossref) return null
  if (!ai) return { ...crossref!, analyzedAt: now }
  if (!crossref) return { ...ai, analyzedAt: now }

  return {
    title: crossref.title ?? ai.title,
    authors: crossref.authors.length > 0 ? crossref.authors : ai.authors,
    venue: crossref.venue ?? ai.venue,
    venueType: crossref.venueType ?? ai.venueType,
    year: crossref.year ?? ai.year,
    doi: crossref.doi ?? ai.doi,
    abstract: crossref.abstract ?? ai.abstract,
    keywords: crossref.keywords.length > 0 ? crossref.keywords : ai.keywords,
    summary: ai.summary,
    source: 'mixed',
    analyzedAt: now
  }
}

const METADATA_SYSTEM_PROMPT = `You extract bibliographic metadata from the first pages of an academic paper.
Return one JSON object and nothing else. Do not wrap it in Markdown.
Use null or [] when a field is not clearly present in the text. Never invent a DOI, venue, or author.
Keep the paper's original language for title, abstract, and keywords.
The "summary" field should be 2-3 sentences in the paper's language and summarize the main contribution.

JSON schema:
{
  "title": string | null,
  "authors": string[],
  "venue": string | null,
  "venueType": "journal" | "conference" | "preprint" | "book" | "other" | null,
  "year": number | null,
  "doi": string | null,
  "abstract": string | null,
  "keywords": string[],
  "summary": string | null
}`

export const buildMetadataMessages = (paperText: string): ChatMessage[] => [
  { role: 'system', content: METADATA_SYSTEM_PROMPT },
  {
    role: 'user',
    content: `Extract the metadata from these paper pages:\n\n${paperText}`
  }
]
