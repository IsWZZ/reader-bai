import { describe, expect, it, vi, type Mock } from 'vitest'
import type { AnnotationMap, AnnotationStore, PaperAnnotation } from '../../src/main/annotations'
import type { LibraryStore, PaperInfo } from '../../src/main/library'
import { createPlatformToolRegistry, type PageTextResult } from '../../src/main/platform-tools'
import type { ToolContext, ToolInvocation, ToolRegistry } from '../../src/main/tool-registry'

const PAPERS: PaperInfo[] = [
  {
    id: 'paper-1',
    title: 'Attention Is All You Need',
    path: '/papers/attention.pdf',
    fileName: 'attention.pdf',
    spaceId: 'space-1',
    titleSource: 'user',
    createdAt: 1
  },
  {
    id: 'paper-2',
    title: 'BERT',
    path: '/papers/bert.pdf',
    fileName: 'bert-paper.pdf',
    spaceId: null,
    titleSource: 'file',
    createdAt: 2
  },
  {
    id: 'paper-3',
    title: 'Vision Transformer',
    path: '/papers/vit.pdf',
    fileName: 'vit.pdf',
    spaceId: 'space-1',
    titleSource: 'file',
    createdAt: 3
  }
]

const EXISTING: PaperAnnotation = {
  id: 'a1',
  type: 'highlight',
  color: '#ffeb3b',
  page: 1,
  rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.02 }],
  text: 'attention',
  createdAt: 10
}

const SECOND: PaperAnnotation = {
  id: 'a2',
  type: 'underline',
  color: '#ef4444',
  page: 2,
  rects: [{ x: 0.2, y: 0.3, width: 0.1, height: 0.02 }],
  text: 'transformer',
  createdAt: 11
}

interface FakeAnnotations extends AnnotationStore {
  snapshot: () => AnnotationMap
}

const createLibrary = (papers: PaperInfo[] = PAPERS): LibraryStore => ({
  read: async () => ({ spaces: [], papers: papers.map((paper) => ({ ...paper })) }),
  write: async () => undefined,
  hasPaperPath: async (filePath) => papers.some((paper) => paper.path === filePath)
})

const createAnnotations = (initial: AnnotationMap = {}): FakeAnnotations => {
  let data: AnnotationMap = structuredClone(initial)
  return {
    read: async () => structuredClone(data),
    write: async (next) => {
      data = structuredClone(next)
    },
    removePaper: async (filePath) => {
      delete data[filePath]
    },
    snapshot: () => structuredClone(data)
  }
}

const context = (): ToolContext => ({
  source: 'ai',
  signal: new AbortController().signal
})

interface SetupResult {
  registry: ToolRegistry
  library: LibraryStore
  annotations: FakeAnnotations
  confirm: Mock
  readPageText: Mock<(paper: PaperInfo, page: number) => Promise<PageTextResult>>
}

interface SetupOptions {
  confirm?: (invocation: ToolInvocation) => boolean | Promise<boolean>
  readPageText?: (paper: PaperInfo, page: number) => Promise<PageTextResult>
}

const setup = (options: SetupOptions = {}): SetupResult => {
  const library = createLibrary()
  const annotations = createAnnotations({ '/papers/attention.pdf': [EXISTING, SECOND] })
  const confirm = vi.fn(
    options.confirm ?? ((async () => true) as (invocation: ToolInvocation) => Promise<boolean>)
  )
  const readPageText = vi.fn(
    options.readPageText ?? (async () => ({ text: 'attention is all you need', pageCount: 5 }))
  )
  const registry = createPlatformToolRegistry({ library, annotations, readPageText, confirm })
  return { registry, library, annotations, confirm, readPageText }
}

const parse = (content: string): Record<string, unknown> =>
  JSON.parse(content) as Record<string, unknown>

describe('platform tools', () => {
  it('exposes only the expected platform tools to AI', () => {
    const { registry } = setup()

    expect(registry.list({ forAi: true }).map((tool) => [tool.name, tool.risk])).toEqual([
      ['library.list', 'read'],
      ['paper.get', 'read'],
      ['paper.readPage', 'read'],
      ['annotations.list', 'read'],
      ['annotations.add', 'write'],
      ['annotations.remove', 'destructive']
    ])
  })

  it('filters papers by query, space and limit', async () => {
    const { registry } = setup()

    const byTitle = parse(
      (await registry.execute('library.list', { query: 'attention' }, context())).content
    )
    expect(byTitle.total).toBe(1)
    expect(byTitle.papers).toEqual([
      {
        id: 'paper-1',
        title: 'Attention Is All You Need',
        fileName: 'attention.pdf',
        spaceId: 'space-1'
      }
    ])

    const byFileName = parse(
      (await registry.execute('library.list', { query: 'bert-paper' }, context())).content
    )
    expect(byFileName.total).toBe(1)

    const bySpace = parse(
      (await registry.execute('library.list', { spaceId: 'space-1', limit: 1 }, context())).content
    )
    expect(bySpace.total).toBe(2)
    expect(bySpace.papers).toHaveLength(1)
  })

  it('does not leak absolute paper paths to the agent', async () => {
    const { registry } = setup()

    const result = await registry.execute('library.list', {}, context())

    expect(result.content).not.toContain('/papers/')
  })

  it('rejects invalid library filters', async () => {
    const { registry } = setup()

    await expect(registry.execute('library.list', { limit: 0 }, context())).rejects.toThrow(
      '参数 limit 必须是'
    )
    await expect(registry.execute('library.list', { query: 1 }, context())).rejects.toThrow(
      '参数 query 必须是字符串'
    )
    await expect(registry.execute('library.list', [], context())).rejects.toThrow('参数必须是对象')
  })

  it('returns paper metadata with the annotation count', async () => {
    const { registry } = setup()

    const paper = parse(
      (await registry.execute('paper.get', { paperId: 'paper-1' }, context())).content
    )

    expect(paper).toEqual({
      id: 'paper-1',
      title: 'Attention Is All You Need',
      fileName: 'attention.pdf',
      spaceId: 'space-1',
      createdAt: 1,
      annotationCount: 2
    })
    await expect(registry.execute('paper.get', { paperId: 'missing' }, context())).rejects.toThrow(
      '论文不存在'
    )
  })

  it('reads a page through the injected extractor', async () => {
    const { registry, readPageText, confirm } = setup()

    const page = parse(
      (await registry.execute('paper.readPage', { paperId: 'paper-1', page: 2 }, context())).content
    )

    expect(readPageText).toHaveBeenCalledWith(expect.objectContaining({ id: 'paper-1' }), 2)
    expect(page).toEqual({
      page: 2,
      pageCount: 5,
      text: 'attention is all you need',
      truncated: false
    })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('truncates long page text and reports it', async () => {
    const { registry } = setup({
      readPageText: async () => ({ text: 'x'.repeat(12_001), pageCount: 1 })
    })

    const page = parse(
      (await registry.execute('paper.readPage', { paperId: 'paper-1', page: 1 }, context())).content
    )

    expect((page.text as string).length).toBe(12_000)
    expect(page.truncated).toBe(true)
  })

  it('rejects malformed page reads', async () => {
    const { registry, readPageText } = setup()

    await expect(
      registry.execute('paper.readPage', { paperId: 'paper-1', page: 0 }, context())
    ).rejects.toThrow('参数 page 必须是')
    await expect(
      registry.execute('paper.readPage', { paperId: 'paper-1', page: 1.5 }, context())
    ).rejects.toThrow('参数 page 必须是')
    await expect(
      registry.execute('paper.readPage', { paperId: 'paper-1' }, context())
    ).rejects.toThrow('缺少参数 page')
    await expect(
      registry.execute('paper.readPage', { paperId: 'missing', page: 1 }, context())
    ).rejects.toThrow('论文不存在')
    expect(readPageText).not.toHaveBeenCalled()
  })

  it('does not register paper.readPage without an extractor', () => {
    const registry = createPlatformToolRegistry({
      library: createLibrary(),
      annotations: createAnnotations()
    })

    expect(registry.list({ forAi: true }).map((tool) => tool.name)).not.toContain('paper.readPage')
  })

  it('lists annotations and filters by page', async () => {
    const { registry } = setup()

    const all = parse(
      (await registry.execute('annotations.list', { paperId: 'paper-1' }, context())).content
    )
    expect(all.total).toBe(2)

    const pageTwo = parse(
      (await registry.execute('annotations.list', { paperId: 'paper-1', page: 2 }, context()))
        .content
    )
    expect(pageTwo.total).toBe(1)
    expect(pageTwo.annotations).toEqual([SECOND])
  })

  it('adds an annotation after confirmation and defaults the color by type', async () => {
    const { registry, annotations, confirm } = setup()

    const result = await registry.execute(
      'annotations.add',
      {
        paperId: 'paper-1',
        page: 3,
        text: 'scaled dot-product attention',
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }]
      },
      context()
    )

    const created = parse(result.content)
    expect(created).toMatchObject({
      type: 'highlight',
      color: '#facc15',
      page: 3,
      text: 'scaled dot-product attention'
    })
    expect(created.id).toEqual(expect.any(String))
    expect(created.createdAt).toEqual(expect.any(Number))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(annotations.snapshot()['/papers/attention.pdf']).toHaveLength(3)
  })

  it('uses the underline color and stores the given color', async () => {
    const { registry, annotations } = setup()

    await registry.execute(
      'annotations.add',
      {
        paperId: 'paper-1',
        type: 'underline',
        color: '#123456',
        page: 1,
        text: 'x',
        rects: [{ x: 0, y: 0, width: 0.1, height: 0.1 }]
      },
      context()
    )

    const stored = annotations.snapshot()['/papers/attention.pdf']
    expect(stored[stored.length - 1]).toMatchObject({ type: 'underline', color: '#123456' })
  })

  it('rejects malformed annotations before asking for confirmation', async () => {
    const { registry, annotations, confirm } = setup()

    await expect(
      registry.execute(
        'annotations.add',
        {
          paperId: 'paper-1',
          page: 1,
          text: '',
          rects: [{ x: 0, y: 0, width: 0.1, height: 0.1 }]
        },
        context()
      )
    ).rejects.toThrow('缺少参数 text')
    await expect(
      registry.execute(
        'annotations.add',
        { paperId: 'paper-1', page: 1, text: 'x', rects: [] },
        context()
      )
    ).rejects.toThrow('标注区域不能为空')
    await expect(
      registry.execute(
        'annotations.add',
        {
          paperId: 'paper-1',
          page: 1,
          text: 'x',
          rects: [{ x: 2, y: 0, width: 0.1, height: 0.1 }]
        },
        context()
      )
    ).rejects.toThrow('标注坐标必须是 0 到 1 之间的数字')
    await expect(
      registry.execute(
        'annotations.add',
        { paperId: 'paper-1', type: 'box', page: 1, text: 'x', rects: [] },
        context()
      )
    ).rejects.toThrow('标注类型不正确')
    await expect(
      registry.execute(
        'annotations.add',
        { paperId: 'paper-1', color: 'red', page: 1, text: 'x', rects: [] },
        context()
      )
    ).rejects.toThrow('颜色格式不正确')

    expect(confirm).not.toHaveBeenCalled()
    expect(annotations.snapshot()['/papers/attention.pdf']).toHaveLength(2)
  })

  it('denies write tools when no confirmation handler is wired', async () => {
    const library = createLibrary()
    const annotations = createAnnotations({ '/papers/attention.pdf': [EXISTING] })
    const registry = createPlatformToolRegistry({ library, annotations })

    await expect(
      registry.execute(
        'annotations.add',
        {
          paperId: 'paper-1',
          page: 1,
          text: 'x',
          rects: [{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }]
        },
        context()
      )
    ).rejects.toThrow('没有权限执行该工具：annotations.add')
    expect(annotations.snapshot()['/papers/attention.pdf']).toHaveLength(1)
  })

  it('removes only the requested annotation ids after confirmation', async () => {
    const { registry, annotations, confirm } = setup()

    const result = await registry.execute(
      'annotations.remove',
      { paperId: 'paper-1', ids: ['a1', 'missing'] },
      context()
    )

    expect(parse(result.content)).toEqual({ removed: ['a1'] })
    expect(annotations.snapshot()['/papers/attention.pdf']).toEqual([SECOND])
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('keeps annotations when the user declines', async () => {
    const { registry, annotations } = setup({ confirm: () => false })

    await expect(
      registry.execute('annotations.remove', { paperId: 'paper-1', ids: ['a1'] }, context())
    ).rejects.toThrow('没有权限执行该工具：annotations.remove')
    expect(annotations.snapshot()['/papers/attention.pdf']).toHaveLength(2)
  })

  it('rejects malformed removal requests', async () => {
    const { registry } = setup()

    await expect(
      registry.execute('annotations.remove', { paperId: 'paper-1', ids: [] }, context())
    ).rejects.toThrow('标注 id 列表不能为空')
    await expect(
      registry.execute('annotations.remove', { paperId: 'paper-1', ids: ['a1', 'a1'] }, context())
    ).rejects.toThrow('标注 id 不能重复')
    await expect(
      registry.execute('annotations.remove', { paperId: 'paper-1', ids: [''] }, context())
    ).rejects.toThrow('标注 id 不正确')
  })

  it('does not write when no requested annotation ids exist', async () => {
    const { registry, annotations } = setup()
    const write = vi.spyOn(annotations, 'write')

    const result = await registry.execute(
      'annotations.remove',
      { paperId: 'paper-1', ids: ['missing'] },
      context()
    )

    expect(parse(result.content)).toEqual({ removed: [] })
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects oversized tool inputs', async () => {
    const { registry, confirm } = setup()

    await expect(
      registry.execute('library.list', { query: 'x'.repeat(201) }, context())
    ).rejects.toThrow('参数 query 过长')

    await expect(
      registry.execute(
        'annotations.add',
        {
          paperId: 'paper-1',
          page: 1,
          text: 'x',
          rects: Array.from({ length: 51 }, () => ({ x: 0, y: 0, width: 0.1, height: 0.1 }))
        },
        context()
      )
    ).rejects.toThrow('标注区域不能超过 50 个')

    await expect(
      registry.execute(
        'annotations.add',
        {
          paperId: 'paper-1',
          page: 1,
          text: 'x',
          rects: [{ x: 0, y: 0, width: 0, height: 0.1 }]
        },
        context()
      )
    ).rejects.toThrow('标注区域不能为空')

    await expect(
      registry.execute(
        'annotations.add',
        {
          paperId: 'paper-1',
          text: 'x',
          rects: [{ x: 0, y: 0, width: 0.1, height: 0.1 }]
        },
        context()
      )
    ).rejects.toThrow('缺少参数 page')

    await expect(
      registry.execute(
        'annotations.remove',
        {
          paperId: 'paper-1',
          ids: Array.from({ length: 101 }, (_, index) => `a-${index}`)
        },
        context()
      )
    ).rejects.toThrow('一次最多删除 100 条标注')

    expect(confirm).not.toHaveBeenCalled()
  })

  it('rejects calls whose context is already aborted', async () => {
    const { registry, confirm } = setup()
    const controller = new AbortController()
    controller.abort()

    await expect(
      registry.execute('library.list', {}, { source: 'ai', signal: controller.signal })
    ).rejects.toThrow('操作已取消')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('does not ask for confirmation on read tools', async () => {
    const { registry, confirm } = setup()

    await registry.execute('library.list', {}, context())
    await registry.execute('paper.get', { paperId: 'paper-1' }, context())
    await registry.execute('annotations.list', { paperId: 'paper-1' }, context())

    expect(confirm).not.toHaveBeenCalled()
  })
})
