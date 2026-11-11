import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline'

// 用内联 worker，避免打包后 file:// 协议下按 URL 加载 worker 失败。
// 整个渲染进程共用同一个 worker，这里只在模块首次加载时创建一次。
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker()

export { pdfjsLib }

const normalizeTitle = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const title = value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title) return null
  return title.slice(0, 300)
}

/** 从 PDF 元数据中解析论文标题，解析不到时返回 null */
export const readPdfTitle = async (data: Uint8Array): Promise<string | null> => {
  // 用独立的 worker 解析元数据：销毁 loading task 会连带销毁 worker，
  // 不能影响阅读器正在使用的那个
  const workerPort = new PdfWorker()
  const worker = pdfjsLib.PDFWorker.create({ port: workerPort })
  const loadingTask = pdfjsLib.getDocument({ data, worker })
  try {
    const doc = await loadingTask.promise
    const metadata = await doc.getMetadata().catch(() => null)
    if (!metadata) return null

    const info = metadata.info as { Title?: unknown } | undefined
    const infoTitle = normalizeTitle(info?.Title)
    if (infoTitle) return infoTitle

    // 部分 PDF 只在 XMP 元数据里写标题
    try {
      return normalizeTitle(metadata.metadata?.get('dc:title'))
    } catch {
      return null
    }
  } finally {
    await loadingTask.destroy().catch(() => undefined)
    workerPort.terminate()
  }
}
