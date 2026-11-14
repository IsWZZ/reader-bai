import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AnnotationMap, AnnotationStore } from '../../src/main/annotations'
import type { LibraryState, LibraryStore, PaperInfo, PaperMetadata } from '../../src/main/library'
import type { PaperAnalyzer } from '../../src/main/paper-analysis'
import type { SettingsStore } from '../../src/main/settings-store'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    }
  }
}))

let registerLibraryIpc: typeof import('../../src/main/ipc/library').registerLibraryIpc

beforeAll(async () => {
  ;({ registerLibraryIpc } = await import('../../src/main/ipc/library'))
})

const paper: PaperInfo = {
  id: 'paper-1',
  title: 'Paper A',
  path: '/papers/a.pdf',
  sourcePath: '/imports/a.pdf',
  fileName: 'a.pdf',
  spaceId: null,
  titleSource: 'user',
  createdAt: 1
}

interface FakeLibrary {
  store: LibraryStore
  snapshot: () => LibraryState
}

const createLibrary = (papers: PaperInfo[]): FakeLibrary => {
  let state: LibraryState = { spaces: [], papers: papers.map((item) => ({ ...item })) }
  return {
    store: {
      read: async () => structuredClone(state),
      write: async (next) => {
        state = structuredClone(next)
      },
      hasPaperPath: async (filePath) => state.papers.some((item) => item.path === filePath),
      mutate: async (fn) => {
        const next = structuredClone(state)
        const result = await fn(next)
        state = structuredClone(next)
        return result
      }
    },
    snapshot: () => structuredClone(state)
  }
}

interface FakeAnnotations {
  store: AnnotationStore
  removePaper: ReturnType<typeof vi.fn>
  snapshot: () => AnnotationMap
}

const createAnnotations = (initial: AnnotationMap): FakeAnnotations => {
  let data = structuredClone(initial)
  const removePaper = vi.fn(async (filePath: string) => {
    delete data[filePath]
  })
  return {
    store: {
      read: async () => structuredClone(data),
      write: async (next) => {
        data = structuredClone(next)
      },
      removePaper
    },
    removePaper,
    snapshot: () => structuredClone(data)
  }
}

// removePaper 不读取设置，只校验它没有参与这条路径
const settings = { libraryDirectory: async () => '/papers' } as unknown as SettingsStore

type RemovePaperHandler = (event: unknown, id: string) => Promise<LibraryState>

const removePaperHandler = (): RemovePaperHandler =>
  electron.handlers.get('library:removePaper') as RemovePaperHandler

describe('library:removePaper', () => {
  it('clears the annotations of the removed paper and keeps the others', async () => {
    const library = createLibrary([paper])
    const annotations = createAnnotations({
      '/papers/a.pdf': [],
      '/papers/b.pdf': []
    })
    registerLibraryIpc(library.store, annotations.store, settings)

    const state = await removePaperHandler()({}, 'paper-1')

    expect(state.papers).toEqual([])
    expect(library.snapshot().papers).toEqual([])
    expect(annotations.removePaper).toHaveBeenCalledWith('/papers/a.pdf')
    expect(annotations.snapshot()).toEqual({ '/papers/b.pdf': [] })
  })

  it('leaves annotations untouched when the paper is not in the library', async () => {
    const library = createLibrary([paper])
    const annotations = createAnnotations({ '/papers/a.pdf': [] })
    registerLibraryIpc(library.store, annotations.store, settings)

    const state = await removePaperHandler()({}, 'missing-paper')

    expect(state.papers).toEqual([paper])
    expect(annotations.removePaper).not.toHaveBeenCalled()
    expect(annotations.snapshot()).toEqual({ '/papers/a.pdf': [] })
  })
})

const metadata: PaperMetadata = {
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani'],
  venue: 'NeurIPS',
  year: 2017,
  doi: '10.5555/ABC.123',
  keywords: [],
  source: 'mixed',
  analyzedAt: 123
}

type AnalyzePaperHandler = (event: unknown, id: unknown, options?: unknown) => Promise<PaperInfo>

const analyzePaperHandler = (): AnalyzePaperHandler =>
  electron.handlers.get('library:analyzePaper') as AnalyzePaperHandler

const registerAnalyze = (
  papers: PaperInfo[]
): {
  library: FakeLibrary
  analyzer: PaperAnalyzer
  analyze: ReturnType<typeof vi.fn>
} => {
  const library = createLibrary(papers)
  const analyze = vi.fn(async () => metadata)
  const analyzer: PaperAnalyzer = { analyze }
  registerLibraryIpc(library.store, createAnnotations({}).store, settings, analyzer)
  return { library, analyzer, analyze }
}

describe('library:analyzePaper', () => {
  it('stores metadata and keeps a user title', async () => {
    const { library, analyze } = registerAnalyze([paper])

    const updated = await analyzePaperHandler()({}, 'paper-1', { useWeb: false })

    expect(analyze).toHaveBeenCalledWith(
      { id: 'paper-1', path: '/papers/a.pdf', title: undefined },
      { useWeb: false }
    )
    expect(updated.metadata).toEqual(metadata)
    expect(updated.title).toBe('Paper A')
    expect(updated.titleSource).toBe('user')
    expect(library.snapshot().papers[0].metadata).toEqual(metadata)
  })

  it('applies the parsed title when it does not come from the user', async () => {
    const filePaper: PaperInfo = { ...paper, title: 'a', titleSource: 'file' }
    const { analyze } = registerAnalyze([filePaper])

    const updated = await analyzePaperHandler()({}, 'paper-1')

    expect(analyze).toHaveBeenCalledWith(
      { id: 'paper-1', path: '/papers/a.pdf', title: 'a' },
      { useWeb: true }
    )
    expect(updated.title).toBe('Attention Is All You Need')
    expect(updated.titleSource).toBe('metadata')
  })

  it('rejects invalid ids, missing papers, and an unavailable analyzer', async () => {
    const { library } = registerAnalyze([paper])
    const handler = analyzePaperHandler()

    await expect(handler({}, 42)).rejects.toThrow('论文不存在')
    await expect(handler({}, 'missing')).rejects.toThrow('论文不存在')

    registerLibraryIpc(library.store, createAnnotations({}).store, settings)
    await expect(analyzePaperHandler()({}, 'paper-1')).rejects.toThrow('当前环境不支持 AI 解析')
  })
})
