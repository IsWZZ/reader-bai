import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AnnotationMap, AnnotationStore } from '../../src/main/annotations'
import type { LibraryState, LibraryStore, PaperInfo } from '../../src/main/library'
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
      hasPaperPath: async (filePath) => state.papers.some((item) => item.path === filePath)
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
