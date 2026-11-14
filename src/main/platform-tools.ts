// 平台能力对外暴露的工具集。
// agent loop 不在平台里，但 agent 需要的读论文、查书库、写标注都必须走这里：
// 统一 schema 校验、风险分级和确认钩子，插件不能绕过。

import { randomUUID } from 'crypto'
import type { AnnotationRect, AnnotationStore, PaperAnnotation } from './annotations'
import type { LibraryStore, PaperInfo } from './library'
import {
  createToolRegistry,
  type ToolContext,
  type ToolDefinition,
  type ToolInvocation,
  type ToolRegistry,
  type ToolResult
} from './tool-registry'

const MAX_QUERY_LENGTH = 200
const MAX_RESULTS = 50
const DEFAULT_RESULTS = 20
const MAX_ANNOTATION_TEXT = 2000
const MAX_RECTS = 50
const MAX_REMOVE_IDS = 100
const MAX_ID_LENGTH = 100
const DEFAULT_HIGHLIGHT_COLOR = '#facc15'
const DEFAULT_UNDERLINE_COLOR = '#ef4444'
const COLOR_PATTERN = /^#[0-9a-f]{3,8}$/i

interface LibraryListInput {
  query?: string
  spaceId?: string
  limit: number
}

interface PaperRefInput {
  paperId: string
}

interface AnnotationsListInput extends PaperRefInput {
  page?: number
}

interface AnnotationsAddInput extends PaperRefInput {
  type: PaperAnnotation['type']
  color: string
  page: number
  text: string
  rects: AnnotationRect[]
}

interface AnnotationsRemoveInput extends PaperRefInput {
  ids: string[]
}

const jsonResult = (value: unknown): ToolResult => ({ content: JSON.stringify(value) })

const asRecord = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('参数必须是对象')
  }
  return input as Record<string, unknown>
}

const readString = (
  input: Record<string, unknown>,
  key: string,
  maxLength: number
): string | undefined => {
  const value = input[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`参数 ${key} 必须是字符串`)
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > maxLength) throw new Error(`参数 ${key} 过长`)
  return trimmed
}

const readRequiredString = (
  input: Record<string, unknown>,
  key: string,
  maxLength: number
): string => {
  const value = readString(input, key, maxLength)
  if (!value) throw new Error(`缺少参数 ${key}`)
  return value
}

const readInteger = (
  input: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fallback?: number
): number | undefined => {
  const value = input[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`参数 ${key} 必须是 ${min} 到 ${max} 之间的整数`)
  }
  return value
}

const readRects = (raw: unknown): AnnotationRect[] => {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('标注区域不能为空')
  if (raw.length > MAX_RECTS) throw new Error(`标注区域不能超过 ${MAX_RECTS} 个`)

  return raw.map((item) => {
    const rect = asRecord(item)
    const coordinate = (key: string): number => {
      const value = rect[key]
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

const readIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('标注 id 列表不能为空')
  if (raw.length > MAX_REMOVE_IDS) throw new Error(`一次最多删除 ${MAX_REMOVE_IDS} 条标注`)

  const ids = raw.map((item) => {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > MAX_ID_LENGTH) {
      throw new Error('标注 id 不正确')
    }
    return item.trim()
  })
  if (new Set(ids).size !== ids.length) throw new Error('标注 id 不能重复')
  return ids
}

const assertActive = (context: ToolContext): void => {
  if (context.signal.aborted) throw new Error('操作已取消')
}

const findPaper = async (library: LibraryStore, paperId: string): Promise<PaperInfo> => {
  const state = await library.read()
  const paper = state.papers.find((item) => item.id === paperId)
  if (!paper) throw new Error('论文不存在')
  return paper
}

const libraryListTool = (library: LibraryStore): ToolDefinition<LibraryListInput> => ({
  name: 'library.list',
  title: '列出论文',
  description:
    '列出论文库中的论文，可按标题/文件名关键词和空间过滤。只读，不会修改书库。返回论文 id、标题、文件名和所属空间。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '按标题或文件名匹配的关键词' },
      spaceId: { type: 'string', description: '只返回该空间内的论文' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_RESULTS,
        description: `最多返回多少条，默认 ${DEFAULT_RESULTS}`
      }
    },
    additionalProperties: false
  },
  risk: 'read',
  exposeToAi: true,
  validate: (input) => {
    const record = asRecord(input)
    return {
      query: readString(record, 'query', MAX_QUERY_LENGTH),
      spaceId: readString(record, 'spaceId', MAX_ID_LENGTH),
      limit: readInteger(record, 'limit', 1, MAX_RESULTS, DEFAULT_RESULTS) ?? DEFAULT_RESULTS
    }
  },
  execute: async (input, context) => {
    assertActive(context)
    const state = await library.read()
    const query = input.query?.toLowerCase()
    const matched = state.papers.filter((paper) => {
      if (input.spaceId && paper.spaceId !== input.spaceId) return false
      if (!query) return true
      return (
        paper.title.toLowerCase().includes(query) || paper.fileName.toLowerCase().includes(query)
      )
    })

    return jsonResult({
      total: matched.length,
      papers: matched.slice(0, input.limit).map((paper) => ({
        id: paper.id,
        title: paper.title,
        fileName: paper.fileName,
        spaceId: paper.spaceId
      }))
    })
  }
})

const paperGetTool = (
  library: LibraryStore,
  annotations: AnnotationStore
): ToolDefinition<PaperRefInput> => ({
  name: 'paper.get',
  title: '查看论文信息',
  description: '按论文 id 返回标题、文件名、所属空间和标注数量。只读。',
  inputSchema: {
    type: 'object',
    properties: {
      paperId: { type: 'string', description: 'library.list 返回的论文 id' }
    },
    required: ['paperId'],
    additionalProperties: false
  },
  risk: 'read',
  exposeToAi: true,
  validate: (input) => ({
    paperId: readRequiredString(asRecord(input), 'paperId', MAX_ID_LENGTH)
  }),
  execute: async (input, context) => {
    assertActive(context)
    const paper = await findPaper(library, input.paperId)
    const store = await annotations.read()
    return jsonResult({
      id: paper.id,
      title: paper.title,
      fileName: paper.fileName,
      spaceId: paper.spaceId,
      createdAt: paper.createdAt,
      annotationCount: (store[paper.path] ?? []).length
    })
  }
})

const annotationsListTool = (
  library: LibraryStore,
  annotations: AnnotationStore
): ToolDefinition<AnnotationsListInput> => ({
  name: 'annotations.list',
  title: '列出论文标注',
  description: '按论文 id 返回高亮/下划线，可按页码过滤。只读。',
  inputSchema: {
    type: 'object',
    properties: {
      paperId: { type: 'string', description: 'library.list 返回的论文 id' },
      page: { type: 'integer', minimum: 1, description: '只返回该页的标注' }
    },
    required: ['paperId'],
    additionalProperties: false
  },
  risk: 'read',
  exposeToAi: true,
  validate: (input) => {
    const record = asRecord(input)
    return {
      paperId: readRequiredString(record, 'paperId', MAX_ID_LENGTH),
      page: readInteger(record, 'page', 1, Number.MAX_SAFE_INTEGER)
    }
  },
  execute: async (input, context) => {
    assertActive(context)
    const paper = await findPaper(library, input.paperId)
    const store = await annotations.read()
    const list = (store[paper.path] ?? []).filter(
      (annotation) => input.page === undefined || annotation.page === input.page
    )
    return jsonResult({
      total: list.length,
      annotations: list.map((annotation) => ({
        id: annotation.id,
        type: annotation.type,
        color: annotation.color,
        page: annotation.page,
        text: annotation.text,
        rects: annotation.rects,
        createdAt: annotation.createdAt
      }))
    })
  }
})

const annotationsAddTool = (
  library: LibraryStore,
  annotations: AnnotationStore
): ToolDefinition<AnnotationsAddInput> => ({
  name: 'annotations.add',
  title: '添加论文标注',
  description:
    '在论文中新增一条高亮或下划线。坐标为相对页面宽高的归一化值（0~1）。会修改标注数据，执行前需要用户确认。',
  inputSchema: {
    type: 'object',
    properties: {
      paperId: { type: 'string', description: 'library.list 返回的论文 id' },
      type: { type: 'string', enum: ['highlight', 'underline'], description: '标注类型' },
      color: { type: 'string', description: '十六进制颜色，缺省按类型选择' },
      page: { type: 'integer', minimum: 1, description: '页码，从 1 开始' },
      text: { type: 'string', description: '被标注的原文' },
      rects: {
        type: 'array',
        description: '标注区域，每项为 { x, y, width, height }，取值 0~1',
        items: {
          type: 'object',
          properties: {
            x: { type: 'number', minimum: 0, maximum: 1 },
            y: { type: 'number', minimum: 0, maximum: 1 },
            width: { type: 'number', minimum: 0, maximum: 1 },
            height: { type: 'number', minimum: 0, maximum: 1 }
          },
          required: ['x', 'y', 'width', 'height']
        }
      }
    },
    required: ['paperId', 'page', 'text', 'rects'],
    additionalProperties: false
  },
  risk: 'write',
  exposeToAi: true,
  validate: (input) => {
    const record = asRecord(input)
    const rawType = record.type ?? 'highlight'
    if (rawType !== 'highlight' && rawType !== 'underline') throw new Error('标注类型不正确')

    const color =
      readString(record, 'color', 20) ??
      (rawType === 'highlight' ? DEFAULT_HIGHLIGHT_COLOR : DEFAULT_UNDERLINE_COLOR)
    if (!COLOR_PATTERN.test(color)) throw new Error('颜色格式不正确')

    const page = readInteger(record, 'page', 1, Number.MAX_SAFE_INTEGER)
    if (page === undefined) throw new Error('缺少参数 page')

    return {
      paperId: readRequiredString(record, 'paperId', MAX_ID_LENGTH),
      type: rawType,
      color,
      page,
      text: readRequiredString(record, 'text', MAX_ANNOTATION_TEXT),
      rects: readRects(record.rects)
    }
  },
  execute: async (input, context) => {
    assertActive(context)
    const paper = await findPaper(library, input.paperId)
    const store = await annotations.read()
    const annotation: PaperAnnotation = {
      id: randomUUID(),
      type: input.type,
      color: input.color,
      page: input.page,
      rects: input.rects,
      text: input.text,
      createdAt: Date.now()
    }

    const list = store[paper.path] ?? []
    list.push(annotation)
    store[paper.path] = list
    await annotations.write(store)

    return jsonResult(annotation)
  }
})

const annotationsRemoveTool = (
  library: LibraryStore,
  annotations: AnnotationStore
): ToolDefinition<AnnotationsRemoveInput> => ({
  name: 'annotations.remove',
  title: '删除论文标注',
  description: '按 id 删除论文标注。会修改标注数据，执行前需要用户确认。',
  inputSchema: {
    type: 'object',
    properties: {
      paperId: { type: 'string', description: 'library.list 返回的论文 id' },
      ids: {
        type: 'array',
        description: '要删除的标注 id',
        items: { type: 'string' },
        minItems: 1,
        maxItems: MAX_REMOVE_IDS
      }
    },
    required: ['paperId', 'ids'],
    additionalProperties: false
  },
  risk: 'destructive',
  exposeToAi: true,
  validate: (input) => {
    const record = asRecord(input)
    return {
      paperId: readRequiredString(record, 'paperId', MAX_ID_LENGTH),
      ids: readIds(record.ids)
    }
  },
  execute: async (input, context) => {
    assertActive(context)
    const paper = await findPaper(library, input.paperId)
    const store = await annotations.read()
    const list = store[paper.path] ?? []
    const idSet = new Set(input.ids)
    const removed = list.filter((annotation) => idSet.has(annotation.id)).map((a) => a.id)

    if (removed.length > 0) {
      store[paper.path] = list.filter((annotation) => !idSet.has(annotation.id))
      await annotations.write(store)
    }

    return jsonResult({ removed })
  }
})

export interface PlatformToolsOptions {
  library: LibraryStore
  annotations: AnnotationStore
  /**
   * 非只读工具的确认钩子。未提供时直接拒绝，
   * 避免插件或渲染进程在没有用户确认的情况下写入标注。
   */
  confirm?: (invocation: ToolInvocation) => boolean | Promise<boolean>
}

/** 注册平台内置工具；写/破坏性工具默认拒绝，必须显式接入确认流程 */
export const createPlatformToolRegistry = (options: PlatformToolsOptions): ToolRegistry => {
  const { library, annotations } = options
  const registry = createToolRegistry({
    authorize: async (invocation) => {
      if (invocation.tool.risk === 'read') return true
      return options.confirm ? options.confirm(invocation) : false
    }
  })

  registry.register(libraryListTool(library))
  registry.register(paperGetTool(library, annotations))
  registry.register(annotationsListTool(library, annotations))
  registry.register(annotationsAddTool(library, annotations))
  registry.register(annotationsRemoveTool(library, annotations))

  return registry
}
