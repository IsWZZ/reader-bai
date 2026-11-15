import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AnnotationMap, AnnotationStore, PaperAnnotation } from '../../src/main/annotations'
import type { LibraryStore } from '../../src/main/library'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    }
  }
}))

let registerAnnotationsIpc: typeof import('../../src/main/ipc/annotations').registerAnnotationsIpc

beforeAll(async () => {
  ;({ registerAnnotationsIpc } = await import('../../src/main/ipc/annotations'))
})

const PAPER_PATH = '/papers/a.pdf'
const OTHER_PATH = '/papers/b.pdf'

const ANNOTATION: PaperAnnotation = {
  id: 'a1',
  type: 'highlight',
  color: '#ffcc00',
  page: 1,
  rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }],
  text: 'quoted text',
  createdAt: 1
}

interface FakeAnnotations {
  store: AnnotationStore
  read: Mock<AnnotationStore['read']>
  write: Mock<AnnotationStore['write']>
  snapshot: () => AnnotationMap
}

const createAnnotations = (initial: AnnotationMap = {}): FakeAnnotations => {
  let data = structuredClone(initial)
  const read = vi.fn<AnnotationStore['read']>(async () => structuredClone(data))
  const write = vi.fn<AnnotationStore['write']>(async (next) => {
    data = structuredClone(next)
  })
  return {
    store: { read, write, removePaper: vi.fn() },
    read,
    write,
    snapshot: () => structuredClone(data)
  }
}

const createLibrary = (...paths: string[]): LibraryStore =>
  ({ hasPaperPath: async (path: string) => paths.includes(path) }) as unknown as LibraryStore

type ListHandler = (event: unknown, path: unknown) => Promise<PaperAnnotation[]>
type AddHandler = (event: unknown, path: unknown, annotation: unknown) => Promise<PaperAnnotation>
type RemoveHandler = (event: unknown, path: unknown, ids: unknown) => Promise<string[]>

const listHandler = (): ListHandler => electron.handlers.get('annotations:list') as ListHandler
const addHandler = (): AddHandler => electron.handlers.get('annotations:add') as AddHandler
const removeHandler = (): RemoveHandler =>
  electron.handlers.get('annotations:remove') as RemoveHandler

beforeEach(() => {
  electron.handlers.clear()
})

describe('annotations:list', () => {
  it('rejects invalid paper paths', async () => {
    const annotations = createAnnotations()
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))
    const handler = listHandler()

    for (const badPath of [42, '', '   ', 'x'.repeat(4097)]) {
      await expect(handler({}, badPath)).rejects.toThrow('论文路径不正确')
    }
    expect(annotations.read).not.toHaveBeenCalled()
  })

  it('rejects papers that are not in the library', async () => {
    const annotations = createAnnotations()
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))

    await expect(listHandler()({}, '/papers/unknown.pdf')).rejects.toThrow(
      'Paper not found in library'
    )
  })

  it('returns an empty list for a paper without annotations', async () => {
    const annotations = createAnnotations({ [OTHER_PATH]: [ANNOTATION] })
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))

    await expect(listHandler()({}, PAPER_PATH)).resolves.toEqual([])
  })

  it('returns the stored annotations of the requested paper', async () => {
    const annotations = createAnnotations({
      [PAPER_PATH]: [ANNOTATION],
      [OTHER_PATH]: [{ ...ANNOTATION, id: 'b1' }]
    })
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))

    await expect(listHandler()({}, PAPER_PATH)).resolves.toEqual([ANNOTATION])
  })
})

describe('annotations:add', () => {
  it('validates the paper path and library membership before parsing', async () => {
    const annotations = createAnnotations()
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))

    await expect(addHandler()({}, 42, ANNOTATION)).rejects.toThrow('论文路径不正确')
    await expect(addHandler()({}, '/papers/unknown.pdf', ANNOTATION)).rejects.toThrow(
      'Paper not found in library'
    )
    expect(annotations.write).not.toHaveBeenCalled()
  })

  it('rejects malformed annotations', async () => {
    const annotations = createAnnotations()
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))
    const handler = addHandler()

    await expect(handler({}, PAPER_PATH, null)).rejects.toThrow('标注格式不正确')
    await expect(handler({}, PAPER_PATH, { ...ANNOTATION, color: 'yellow' })).rejects.toThrow(
      '标注颜色不正确'
    )
    await expect(handler({}, PAPER_PATH, { ...ANNOTATION, rects: [] })).rejects.toThrow(
      '标注区域不能为空'
    )
    await expect(handler({}, PAPER_PATH, { ...ANNOTATION, page: 0 })).rejects.toThrow(
      '标注页码不正确'
    )
    expect(annotations.write).not.toHaveBeenCalled()
  })

  it('trims the id and persists the annotation', async () => {
    const annotations = createAnnotations()
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))

    const added = await addHandler()({}, PAPER_PATH, { ...ANNOTATION, id: '  a1  ' })

    expect(added).toEqual(ANNOTATION)
    expect(annotations.snapshot()).toEqual({ [PAPER_PATH]: [ANNOTATION] })
    expect(annotations.write).toHaveBeenCalledOnce()
  })

  it('keeps annotations of other papers', async () => {
    const other = { ...ANNOTATION, id: 'b1' }
    const annotations = createAnnotations({ [OTHER_PATH]: [other] })
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH, OTHER_PATH))

    await addHandler()({}, PAPER_PATH, ANNOTATION)

    expect(annotations.snapshot()).toEqual({
      [OTHER_PATH]: [other],
      [PAPER_PATH]: [ANNOTATION]
    })
  })

  it('rejects duplicate ids and the per-paper limit', async () => {
    const duplicate = createAnnotations({ [PAPER_PATH]: [ANNOTATION] })
    registerAnnotationsIpc(duplicate.store, createLibrary(PAPER_PATH))
    await expect(addHandler()({}, PAPER_PATH, ANNOTATION)).rejects.toThrow('标注已存在')
    expect(duplicate.write).not.toHaveBeenCalled()

    const many = Array.from({ length: 5000 }, (_, index) => ({
      ...ANNOTATION,
      id: `a${index}`
    }))
    const full = createAnnotations({ [PAPER_PATH]: many })
    registerAnnotationsIpc(full.store, createLibrary(PAPER_PATH))
    await expect(addHandler()({}, PAPER_PATH, { ...ANNOTATION, id: 'overflow' })).rejects.toThrow(
      '该论文的标注数量已达上限'
    )
    expect(full.write).not.toHaveBeenCalled()
  })
})

describe('annotations:remove', () => {
  it('rejects invalid paper paths and id lists', async () => {
    const annotations = createAnnotations()
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))
    const handler = removeHandler()

    await expect(handler({}, 42, ['a1'])).rejects.toThrow('论文路径不正确')
    await expect(handler({}, PAPER_PATH, undefined)).rejects.toThrow('标注 id 列表不正确')
    await expect(handler({}, PAPER_PATH, [])).rejects.toThrow('标注 id 列表不正确')
    await expect(handler({}, PAPER_PATH, 'a1')).rejects.toThrow('标注 id 列表不正确')
    await expect(handler({}, PAPER_PATH, [42])).rejects.toThrow('标注 id 不正确')
    await expect(handler({}, PAPER_PATH, ['   '])).rejects.toThrow('标注 id 不正确')
    await expect(handler({}, PAPER_PATH, ['x'.repeat(101)])).rejects.toThrow('标注 id 不正确')
    await expect(
      handler(
        {},
        PAPER_PATH,
        Array.from({ length: 101 }, (_, index) => `a${index}`)
      )
    ).rejects.toThrow('一次最多删除 100 条标注')
    expect(annotations.read).not.toHaveBeenCalled()
  })

  it('rejects papers that are not in the library', async () => {
    const annotations = createAnnotations()
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))

    await expect(removeHandler()({}, '/papers/unknown.pdf', ['a1'])).rejects.toThrow(
      'Paper not found in library'
    )
  })

  it('removes trimmed ids and keeps the remaining annotations', async () => {
    const second = { ...ANNOTATION, id: 'a2' }
    const third = { ...ANNOTATION, id: 'a3' }
    const annotations = createAnnotations({ [PAPER_PATH]: [ANNOTATION, second, third] })
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))

    const removed = await removeHandler()({}, PAPER_PATH, [' a1 ', 'a3'])

    expect(removed).toEqual(['a1', 'a3'])
    expect(annotations.snapshot()).toEqual({ [PAPER_PATH]: [second] })
    expect(annotations.write).toHaveBeenCalledOnce()
  })

  it('returns an empty list without writing when nothing matches', async () => {
    const annotations = createAnnotations({ [PAPER_PATH]: [ANNOTATION] })
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))

    await expect(removeHandler()({}, PAPER_PATH, ['missing'])).resolves.toEqual([])
    expect(annotations.write).not.toHaveBeenCalled()
  })

  it('accepts exactly 100 ids', async () => {
    const annotations = createAnnotations()
    registerAnnotationsIpc(annotations.store, createLibrary(PAPER_PATH))

    const ids = Array.from({ length: 100 }, (_, index) => `a${index}`)
    await expect(removeHandler()({}, PAPER_PATH, ids)).resolves.toEqual([])
    expect(annotations.read).toHaveBeenCalledOnce()
  })
})
