// 主进程侧的 PDF 文本提取，供平台工具读取论文正文和导入后的元数据解析。
// pdfjs 只在需要时动态加载，避免拖慢启动；构建时保持 external，运行时从 node_modules 读取。

import { readFile, stat } from 'fs/promises'

const PARSE_TIMEOUT_MS = 20_000
const MAX_PDF_BYTES = 100 * 1024 * 1024
const DEFAULT_INTRO_PAGES = 3
const MAX_INTRO_PAGES = 10
const DEFAULT_INTRO_CHARS = 12_000
const MAX_INTRO_CHARS = 40_000

export interface PdfPageText {
  text: string
  pageCount: number
}

export interface PdfIntroText {
  text: string
  pageCount: number
  pagesRead: number
}

export interface PdfIntroTextOptions {
  /** 最多读取前几页，默认 3 页 */
  maxPages?: number
  /** 截断后的最大字符数，默认 12000 */
  maxChars?: number
}

interface PdfTextItem {
  str?: string
  hasEOL?: boolean
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfDocument = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>

let pdfjs: Promise<PdfjsModule> | null = null

const loadPdfjs = (): Promise<PdfjsModule> => {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs
}

const joinTextItems = (items: PdfTextItem[]): string => {
  let text = ''
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  // 去掉行尾空白和过多的空行，避免模型收到噪声
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 统一做大小检查和加载超时，确保每个文档只解析一次 */
const withPdfDocument = async <T>(
  filePath: string,
  handler: (document: PdfDocument) => Promise<T>
): Promise<T> => {
  const info = await stat(filePath)
  if (info.size > MAX_PDF_BYTES) throw new Error('PDF 文件过大，无法读取')

  const data = new Uint8Array(await readFile(filePath))
  const { getDocument } = await loadPdfjs()
  const loadingTask = getDocument({ data, disableFontFace: true })

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const document = await Promise.race([
      loadingTask.promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('PDF 解析超时')), PARSE_TIMEOUT_MS)
      })
    ])
    return await handler(document)
  } finally {
    if (timer) clearTimeout(timer)
    await loadingTask.destroy().catch(() => undefined)
  }
}

/** 读取指定页的文本；页码从 1 开始，超出范围时给出可读错误 */
export const readPdfPageText = async (filePath: string, pageNumber: number): Promise<PdfPageText> =>
  withPdfDocument(filePath, async (document) => {
    if (pageNumber < 1 || pageNumber > document.numPages) {
      throw new Error(`页码超出范围（共 ${document.numPages} 页）`)
    }

    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    return {
      text: joinTextItems(content.items as PdfTextItem[]),
      pageCount: document.numPages
    }
  })

const clampInt = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/**
 * 读取论文开头几页，供导入后的元数据解析使用。
 * 只读一次文档，按页累加并在达到字符上限时停止。
 */
export const readPdfIntroText = async (
  filePath: string,
  options: PdfIntroTextOptions = {}
): Promise<PdfIntroText> => {
  const maxPages = clampInt(options.maxPages, DEFAULT_INTRO_PAGES, 1, MAX_INTRO_PAGES)
  const maxChars = clampInt(options.maxChars, DEFAULT_INTRO_CHARS, 1, MAX_INTRO_CHARS)

  return withPdfDocument(filePath, async (document) => {
    let text = ''
    let pagesRead = 0
    const lastPage = Math.min(maxPages, document.numPages)

    for (let pageNumber = 1; pageNumber <= lastPage; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = joinTextItems(content.items as PdfTextItem[])
      if (pageText) text += `${text ? '\n\n' : ''}${pageText}`
      pagesRead += 1
      if (text.length >= maxChars) break
    }

    return {
      text: text.slice(0, maxChars),
      pageCount: document.numPages,
      pagesRead
    }
  })
}
