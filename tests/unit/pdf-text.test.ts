// @vitest-environment node
import { mkdtemp, open, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPdfPageText } from '../../src/main/pdf-text'

// 最小可解析 PDF；对象偏移量按真实字节计算，pdf.js 才能定位交叉引用表。
const buildPdf = (pages: string[]): Buffer => {
  const pageIds = pages.map((_, index) => 3 + index)
  const contentIds = pages.map((_, index) => 3 + pages.length + index)
  const fontId = 3 + pages.length * 2
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  ]

  for (const id of pageIds) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[id - 3]} 0 R >>`
    )
  }

  for (const text of pages) {
    const content = `BT /F1 18 Tf 40 100 Td (${text}) Tj ET`
    objects.push(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
    )
  }

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reader-bai-pdf-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readPdfPageText', () => {
  it('extracts text and reports the page count', async () => {
    const path = join(dir, 'sample.pdf')
    await writeFile(path, buildPdf(['Hello reader-bai', 'Second page']))

    await expect(readPdfPageText(path, 1)).resolves.toEqual({
      text: 'Hello reader-bai',
      pageCount: 2
    })
    await expect(readPdfPageText(path, 2)).resolves.toEqual({
      text: 'Second page',
      pageCount: 2
    })
  })

  it('rejects pages outside the document', async () => {
    const path = join(dir, 'sample.pdf')
    await writeFile(path, buildPdf(['Only page']))

    await expect(readPdfPageText(path, 0)).rejects.toThrow('页码超出范围（共 1 页）')
    await expect(readPdfPageText(path, 2)).rejects.toThrow('页码超出范围（共 1 页）')
  })

  it('rejects missing and corrupt files', async () => {
    await expect(readPdfPageText(join(dir, 'missing.pdf'), 1)).rejects.toThrow()
    const corrupt = join(dir, 'corrupt.pdf')
    await writeFile(corrupt, 'not a pdf')
    await expect(readPdfPageText(corrupt, 1)).rejects.toThrow()
  })

  it('rejects files larger than the size limit before parsing', async () => {
    const path = join(dir, 'huge.pdf')
    const handle = await open(path, 'w')
    try {
      await handle.truncate(101 * 1024 * 1024)
    } finally {
      await handle.close()
    }

    await expect(readPdfPageText(path, 1)).rejects.toThrow('PDF 文件过大，无法读取')
  })
})
