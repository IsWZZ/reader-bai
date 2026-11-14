import { readFile, writeFile } from 'fs/promises'

export interface AnnotationRect {
  // 相对页面宽高的归一化坐标（0~1），缩放后依然对齐
  x: number
  y: number
  width: number
  height: number
}

export interface PaperAnnotation {
  id: string
  type: 'highlight' | 'underline'
  color: string
  page: number
  rects: AnnotationRect[]
  text: string
  createdAt: number
}

export type AnnotationMap = Record<string, PaperAnnotation[]>

export interface AnnotationStore {
  read: () => Promise<AnnotationMap>
  write: (store: AnnotationMap) => Promise<void>
  /** 论文从书库移除后清空它的标注，避免留下无法再访问的孤儿数据 */
  removePaper: (filePath: string) => Promise<void>
}

const MAX_ID_LENGTH = 100
const MAX_COLOR_LENGTH = 20
const MAX_TEXT_LENGTH = 20_000
const MAX_RECTS = 500
const MAX_PAGE = 1_000_000
const MAX_ANNOTATIONS_PER_PAPER = 5_000
const MAX_PATH_LENGTH = 4096
const COLOR_PATTERN = /^#[0-9a-f]{3,8}$/i

const objectOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const parseRects = (raw: unknown): AnnotationRect[] => {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('标注区域不能为空')
  if (raw.length > MAX_RECTS) throw new Error(`标注区域不能超过 ${MAX_RECTS} 个`)

  return raw.map((item) => {
    const rect = objectOf(item)
    const coordinate = (key: string): number => {
      const value = rect?.[key]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error('标注坐标必须是 0 到 1 之间的数字')
      }
      return value
    }
    const x = coordinate('x')
    const y = coordinate('y')
    const width = coordinate('width')
    const height = coordinate('height')
    if (width === 0 || height === 0) throw new Error('标注区域不能为空')
    return { x, y, width, height }
  })
}

/** 逐字段校验渲染进程或磁盘送来的标注，写库前必须经过这里 */
export const parsePaperAnnotation = (raw: unknown): PaperAnnotation => {
  const record = objectOf(raw)
  if (!record) throw new Error('标注格式不正确')

  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id || id.length > MAX_ID_LENGTH) throw new Error('标注 id 不正确')

  const type = record.type
  if (type !== 'highlight' && type !== 'underline') throw new Error('标注类型不正确')

  const color = typeof record.color === 'string' ? record.color.trim() : ''
  if (!color || color.length > MAX_COLOR_LENGTH || !COLOR_PATTERN.test(color)) {
    throw new Error('标注颜色不正确')
  }

  const page = record.page
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new Error('标注页码不正确')
  }

  if (typeof record.text !== 'string' || record.text.length > MAX_TEXT_LENGTH) {
    throw new Error('标注文本不正确')
  }

  const createdAt = record.createdAt
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
    throw new Error('标注时间不正确')
  }

  return {
    id,
    type,
    color,
    page,
    rects: parseRects(record.rects),
    text: record.text,
    createdAt
  }
}

/** 读取本地文件时逐条清洗；坏数据丢弃而不是让整个标注库不可用 */
export const normalizeAnnotationMap = (raw: unknown): AnnotationMap => {
  const source = objectOf(raw)
  if (!source) return {}

  const result: AnnotationMap = {}
  for (const [path, list] of Object.entries(source)) {
    if (!path || path.length > MAX_PATH_LENGTH || !Array.isArray(list)) continue
    const annotations: PaperAnnotation[] = []
    for (const item of list.slice(0, MAX_ANNOTATIONS_PER_PAPER)) {
      try {
        annotations.push(parsePaperAnnotation(item))
      } catch {
        // 跳过损坏的标注
      }
    }
    result[path] = annotations
  }
  return result
}

export const createAnnotationStore = (annotationsFile: string): AnnotationStore => {
  const read = async (): Promise<AnnotationMap> => {
    try {
      const raw = await readFile(annotationsFile, 'utf-8')
      return normalizeAnnotationMap(JSON.parse(raw))
    } catch {
      return {}
    }
  }

  const write = async (store: AnnotationMap): Promise<void> => {
    await writeFile(annotationsFile, JSON.stringify(store, null, 2), 'utf-8')
  }

  const removePaper = async (filePath: string): Promise<void> => {
    const store = await read()
    if (!(filePath in store)) return
    delete store[filePath]
    await write(store)
  }

  return { read, write, removePaper }
}
