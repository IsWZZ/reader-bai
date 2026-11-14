// 主进程侧的 PDF 文本提取，供平台工具读取论文正文。
// pdfjs 只在需要时动态加载，避免拖慢启动；构建时保持 external，运行时从 node_modules 读取。

import { readFile, stat } from 'fs/promises'

const PARSE_TIMEOUT_MS = 20_000
const MAX_PDF_BYTES = 100 * 1024 * 1024

export interface PdfPageText {
  text: string
  pageCount: number
}

interface PdfTextItem {
  str?: string
  hasEOL?: boolean
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

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

/** 读取指定页的文本；页码从 1 开始，超出范围时给出可读错误 */
export const readPdfPageText = async (
  filePath: string,
  pageNumber: number
): Promise<PdfPageText> => {
  const info = await stat(filePath)
  if (info.size > MAX_PDF_BYTES) throw new Error('PDF 文件过大，无法读取')

  const data = new Uint8Array(await readFile(filePath))
  const { getDocument } = await loadPdfjs()
  const loadingTask = getDocument({ data, disableFontFace: true })

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const doc = await Promise.race([
      loadingTask.promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('PDF 解析超时')), PARSE_TIMEOUT_MS)
      })
    ])

    if (pageNumber < 1 || pageNumber > doc.numPages) {
      throw new Error(`页码超出范围（共 ${doc.numPages} 页）`)
    }

    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    return {
      text: joinTextItems(content.items as PdfTextItem[]),
      pageCount: doc.numPages
    }
  } finally {
    if (timer) clearTimeout(timer)
    await loadingTask.destroy().catch(() => undefined)
  }
}
