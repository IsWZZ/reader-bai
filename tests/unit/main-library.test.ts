import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  baseName,
  copyIntoLibraryDirectory,
  createLibraryStore,
  fileStem,
  isInsideDirectory,
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
  it('normalizes papers and drops invalid entries', () => {
    const state = normalizeLibrary({
      papers: [
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
      ]
    })

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
    expect(normalizeLibrary([{ path: '/papers/attention.pdf' }])).toEqual({
      spaces: [],
      papers: []
    })
  })
})

describe('file helpers', () => {
  it('handles posix and windows paths', () => {
    expect(baseName('/papers/deep/attention.pdf')).toBe('attention.pdf')
    expect(baseName('C:\\papers\\attention.pdf')).toBe('attention.pdf')
    expect(fileStem('C:\\papers\\attention.PDF')).toBe('attention')
  })
})

describe('library directory helpers', () => {
  it('detects files inside the library directory', () => {
    expect(isInsideDirectory('/papers', '/papers/attention.pdf')).toBe(true)
    expect(isInsideDirectory('/papers', '/papers/nested/attention.pdf')).toBe(true)
    expect(isInsideDirectory('/papers', '/papers')).toBe(false)
    expect(isInsideDirectory('/papers', '/papers-other/attention.pdf')).toBe(false)
    expect(isInsideDirectory('/papers', '/tmp/attention.pdf')).toBe(false)
  })

  it('copies a file into the library directory and keeps the original', async () => {
    const source = join(dir, 'attention.pdf')
    const libraryDir = join(dir, 'papers')
    await writeFile(source, 'pdf-bytes', 'utf-8')

    const storedPath = await copyIntoLibraryDirectory(source, libraryDir)

    expect(storedPath).toBe(join(libraryDir, 'attention.pdf'))
    await expect(readFile(storedPath, 'utf-8')).resolves.toBe('pdf-bytes')
    await expect(readFile(source, 'utf-8')).resolves.toBe('pdf-bytes')
  })

  it('avoids overwriting files with the same name', async () => {
    const sourceA = join(dir, 'a', 'attention.pdf')
    const sourceB = join(dir, 'b', 'attention.pdf')
    await mkdir(join(dir, 'a'), { recursive: true })
    await mkdir(join(dir, 'b'), { recursive: true })
    await writeFile(sourceA, 'first', 'utf-8')
    await writeFile(sourceB, 'second', 'utf-8')
    const libraryDir = join(dir, 'papers')

    const storedFirst = await copyIntoLibraryDirectory(sourceA, libraryDir)
    const storedSecond = await copyIntoLibraryDirectory(sourceB, libraryDir)

    expect(storedFirst).toBe(join(libraryDir, 'attention.pdf'))
    expect(storedSecond).toBe(join(libraryDir, 'attention (2).pdf'))
    await expect(readFile(storedFirst, 'utf-8')).resolves.toBe('first')
    await expect(readFile(storedSecond, 'utf-8')).resolves.toBe('second')
  })

  it('returns the original path when it is already inside the directory', async () => {
    const libraryDir = join(dir, 'papers')
    await mkdir(libraryDir, { recursive: true })
    const source = join(libraryDir, 'attention.pdf')
    await writeFile(source, 'pdf-bytes', 'utf-8')

    await expect(copyIntoLibraryDirectory(source, libraryDir)).resolves.toBe(source)
  })

  it('creates the library directory when it does not exist', async () => {
    const libraryDir = join(dir, 'deep', 'papers')
    const source = join(dir, 'attention.pdf')
    await writeFile(source, 'pdf-bytes', 'utf-8')

    const storedPath = await copyIntoLibraryDirectory(source, libraryDir)

    await expect(access(storedPath)).resolves.toBeUndefined()
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
