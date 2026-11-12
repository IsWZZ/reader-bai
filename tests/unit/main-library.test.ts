import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  baseName,
  createLibraryStore,
  fileStem,
  normalizeLibrary,
  type LibraryState
} from '../../src/main/library'

let dir: string
let libraryFile: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reader-bai-library-'))
  libraryFile = join(dir, 'library.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('normalizeLibrary', () => {
  it('migrates the legacy paper array format', () => {
    const state = normalizeLibrary([
      { path: '/papers/attention.pdf' },
      { title: 'ignored without path' },
      null,
      {
        id: 'kept',
        title: 'User title',
        path: 'C:\\papers\\bert.PDF',
        fileName: 'bert.PDF',
        spaceId: 'missing-space',
        titleSource: 'user',
        createdAt: 1
      }
    ])

    expect(state.spaces).toEqual([])
    expect(state.papers).toHaveLength(2)
    expect(state.papers[0]).toMatchObject({
      title: 'attention',
      fileName: 'attention.pdf',
      spaceId: null,
      titleSource: 'file'
    })
    expect(state.papers[0].id).toBeTruthy()
    expect(state.papers[1]).toMatchObject({
      id: 'kept',
      title: 'User title',
      path: 'C:\\papers\\bert.PDF',
      spaceId: null,
      titleSource: 'user'
    })
  })

  it('keeps spaces and moves papers of unknown spaces to uncategorized', () => {
    const state = normalizeLibrary({
      spaces: [
        { id: 's1', name: 'Reading', createdAt: 1 },
        { id: 'invalid', name: 42 }
      ],
      papers: [
        { path: '/a.pdf', spaceId: 's1' },
        { path: '/b.pdf', spaceId: 'deleted' }
      ]
    })

    expect(state.spaces.map((space) => space.id)).toEqual(['s1'])
    expect(state.papers.map((paper) => paper.spaceId)).toEqual(['s1', null])
  })

  it('returns an empty library for invalid input', () => {
    expect(normalizeLibrary(null)).toEqual({ spaces: [], papers: [] })
    expect(normalizeLibrary('broken')).toEqual({ spaces: [], papers: [] })
  })
})

describe('file helpers', () => {
  it('handles posix and windows paths', () => {
    expect(baseName('/papers/deep/attention.pdf')).toBe('attention.pdf')
    expect(baseName('C:\\papers\\attention.pdf')).toBe('attention.pdf')
    expect(fileStem('C:\\papers\\attention.PDF')).toBe('attention')
  })
})

describe('createLibraryStore', () => {
  it('returns an empty library when the file does not exist', async () => {
    const store = createLibraryStore(libraryFile)
    await expect(store.read()).resolves.toEqual({ spaces: [], papers: [] })
  })

  it('returns an empty library when the file is corrupted', async () => {
    await writeFile(libraryFile, '{not json', 'utf-8')
    const store = createLibraryStore(libraryFile)
    await expect(store.read()).resolves.toEqual({ spaces: [], papers: [] })
  })

  it('persists state and checks paper membership by path', async () => {
    const store = createLibraryStore(libraryFile)
    const state: LibraryState = {
      spaces: [{ id: 's1', name: 'Reading', createdAt: 1 }],
      papers: [
        {
          id: 'p1',
          title: 'Attention',
          path: '/papers/attention.pdf',
          fileName: 'attention.pdf',
          spaceId: 's1',
          titleSource: 'file',
          createdAt: 1
        }
      ]
    }

    await store.write(state)

    await expect(store.read()).resolves.toEqual(state)
    await expect(store.hasPaperPath('/papers/attention.pdf')).resolves.toBe(true)
    await expect(store.hasPaperPath('/papers/other.pdf')).resolves.toBe(false)
  })
})
