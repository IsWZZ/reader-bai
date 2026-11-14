// Crossref 书目检索：用 DOI 精确定位，或用标题做一次模糊搜索并校验相似度。
// 只访问固定的 Crossref 主机；不把用户可控的 URL 直接交给 fetch。

import {
  normalizeDoi,
  normalizePaperMetadata,
  type PaperMetadata,
  type PaperVenueType
} from './paper-metadata'

const CROSSREF_WORKS_URL = 'https://api.crossref.org/works'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_CHARS = 2_000_000
const MAX_TITLE_ROWS = 5
const MIN_TITLE_LENGTH = 8
/** 标题检索的最低相似度，避免把不同论文的条目补进来 */
export const TITLE_MATCH_THRESHOLD = 0.8
const USER_AGENT = 'reader-bai/1.0'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface CrossrefLookupOptions {
  doi?: string
  title?: string
  /** 注入 fetch 便于测试；默认使用全局 fetch */
  fetch?: FetchLike
  signal?: AbortSignal
  now?: number
}

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'for',
  'from',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with'
])

const titleTokens = (value: string): string[] =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token && !TITLE_STOP_WORDS.has(token))

const dice = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) return 0
  let common = 0
  for (const token of left) {
    if (right.has(token)) common += 1
  }
  return (2 * common) / (left.size + right.size)
}

const tokenBigrams = (tokens: string[]): Set<string> => {
  const bigrams = new Set<string>()
  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.add(`${tokens[index]} ${tokens[index + 1]}`)
  }
  return bigrams
}

/**
 * 同时比较词集合和词序（bigram）。
 * 只用词集合时，“Is Attention All You Need?” 会和原论文同分，
 * 加上 bigram 才能把这种换序标题压到阈值以下。
 */
export const titleSimilarity = (left: string, right: string): number => {
  const leftTokens = titleTokens(left)
  const rightTokens = titleTokens(right)
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0

  const unigram = dice(new Set(leftTokens), new Set(rightTokens))
  const leftBigrams = tokenBigrams(leftTokens)
  const rightBigrams = tokenBigrams(rightTokens)
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return unigram
  return (unigram + dice(leftBigrams, rightBigrams)) / 2
}

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const firstString = (value: unknown): string => {
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    const text = asString(item)
    if (text) return text
  }
  return ''
}

const eventName = (value: unknown): string => {
  if (!value || typeof value !== 'object') return ''
  return asString((value as Record<string, unknown>).name)
}

const stripMarkup = (value: string): string =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

const mapVenueType = (type: string): PaperVenueType | undefined => {
  switch (type) {
    case 'journal-article':
    case 'journal-issue':
    case 'journal-volume':
      return 'journal'
    case 'proceedings-article':
    case 'proceedings':
      return 'conference'
    case 'posted-content':
    case 'preprint':
      return 'preprint'
    case 'book':
    case 'book-chapter':
    case 'monograph':
    case 'edited-book':
      return 'book'
    default:
      return type ? 'other' : undefined
  }
}

const mapAuthors = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  const authors: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const author = item as Record<string, unknown>
    const given = asString(author.given)
    const family = asString(author.family)
    const name = asString(author.name)
    const display = given && family ? `${given} ${family}` : family || name
    if (!display || seen.has(display)) continue
    seen.add(display)
    authors.push(display)
    if (authors.length >= 40) break
  }
  return authors
}

const mapYear = (raw: unknown): number | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const dateParts = (raw as Record<string, unknown>)['date-parts']
  if (!Array.isArray(dateParts) || !Array.isArray(dateParts[0])) return undefined
  const year = dateParts[0][0]
  return typeof year === 'number' && Number.isFinite(year) ? Math.trunc(year) : undefined
}

const mapCategories = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => asString(item))
    .filter(Boolean)
    .slice(0, 20)
}

/** 把 Crossref 的 works 条目归一化成项目内的元数据结构 */
export const mapCrossrefWork = (raw: unknown, now: number = Date.now()): PaperMetadata | null => {
  if (!raw || typeof raw !== 'object') return null
  const work = raw as Record<string, unknown>

  const abstractRaw = asString(work.abstract)
  const metadata: PaperMetadata = {
    authors: mapAuthors(work.author),
    keywords: mapCategories(work.subject),
    source: 'crossref',
    analyzedAt: now
  }

  const title = firstString(work.title)
  if (title) metadata.title = title
  const venue = firstString(work['container-title']) || eventName(work['event'])
  if (venue) metadata.venue = venue
  const venueType = mapVenueType(asString(work.type))
  if (venueType) metadata.venueType = venueType
  const year = mapYear(work.issued)
  if (year) metadata.year = year
  const doi = normalizeDoi(asString(work.DOI))
  if (doi) metadata.doi = doi
  const abstract = stripMarkup(abstractRaw)
  if (abstract) metadata.abstract = abstract

  // 复用统一的长度/字段清洗，避免把 Crossref 的超长字段直接写进 library.json
  return normalizePaperMetadata(metadata, 'crossref', now)
}

interface RequestOptions {
  fetch?: FetchLike
  signal?: AbortSignal
}

/** 带超时和体积上限的 JSON 请求；任何异常都由调用方降级处理 */
const requestJson = async (url: string, options: RequestOptions): Promise<unknown> => {
  const fetchImpl = options.fetch ?? fetch
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal
    })
    if (!response.ok) return null

    const declared = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_CHARS) return null

    const text = await response.text()
    if (text.length > MAX_RESPONSE_CHARS) return null
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

const workMessage = (payload: unknown): unknown => {
  if (!payload || typeof payload !== 'object') return null
  return (payload as Record<string, unknown>).message ?? null
}

const lookupByDoi = async (
  doi: string,
  options: RequestOptions & { now: number }
): Promise<PaperMetadata | null> => {
  const url = `${CROSSREF_WORKS_URL}/${encodeURIComponent(doi)}`
  const payload = await requestJson(url, options)
  return mapCrossrefWork(workMessage(payload), options.now)
}

const lookupByTitle = async (
  title: string,
  options: RequestOptions & { now: number }
): Promise<PaperMetadata | null> => {
  const url = new URL(CROSSREF_WORKS_URL)
  url.searchParams.set('query.bibliographic', title)
  url.searchParams.set('rows', String(MAX_TITLE_ROWS))
  url.searchParams.set('select', 'DOI,title,author,container-title,issued,type,abstract,subject')
  const payload = await requestJson(url.toString(), options)
  const message = workMessage(payload)
  if (!message || typeof message !== 'object') return null
  const items = (message as Record<string, unknown>).items
  if (!Array.isArray(items)) return null

  let best: { score: number; metadata: PaperMetadata } | null = null
  for (const item of items) {
    const metadata = mapCrossrefWork(item, options.now)
    if (!metadata?.title) continue
    const score = titleSimilarity(title, metadata.title)
    if (score < TITLE_MATCH_THRESHOLD) continue
    if (!best || score > best.score) best = { score, metadata }
  }
  return best?.metadata ?? null
}

/**
 * 用 DOI 或标题查询 Crossref。失败、超时或标题不够相似时返回 null，
 * 调用方保留 AI 解析结果即可。
 */
export const lookupCrossref = async (
  options: CrossrefLookupOptions
): Promise<PaperMetadata | null> => {
  const now = options.now ?? Date.now()
  const doi = normalizeDoi(options.doi)
  if (doi) {
    return lookupByDoi(doi, { fetch: options.fetch, signal: options.signal, now })
  }

  const title = asString(options.title)
  if (title.length < MIN_TITLE_LENGTH) return null
  return lookupByTitle(title, { fetch: options.fetch, signal: options.signal, now })
}
