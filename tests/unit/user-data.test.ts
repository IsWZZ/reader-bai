import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createUserDataPaths,
  migrateLegacyUserData,
  rewriteAnnotationKeys,
  rewriteLibraryPaths
} from '../../src/main/user-data'

let userDataRoot: string

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown

beforeEach(async () => {
  userDataRoot = await mkdtemp(join(tmpdir(), 'reader-bai-user-data-'))
})

afterEach(async () => {
  await rm(userDataRoot, { recursive: true, force: true })
})

describe('createUserDataPaths', () => {
  it('keeps application files under userData/data', () => {
    const paths = createUserDataPaths('/tmp/reader-bai')

    expect(paths).toEqual({
      dataRoot: '/tmp/reader-bai/data',
      libraryFile: '/tmp/reader-bai/data/library.json',
      annotationsFile: '/tmp/reader-bai/data/annotations.json',
      settingsFile: '/tmp/reader-bai/data/settings.json',
      pluginsStateFile: '/tmp/reader-bai/data/plugins.json',
      pluginsDirectory: '/tmp/reader-bai/data/plugins',
      papersDirectory: '/tmp/reader-bai/data/papers'
    })
  })
})

describe('path rewrite helpers', () => {
  it('rewrites library paths only when they are inside the old papers directory', () => {
    const result = rewriteLibraryPaths(
      {
        spaces: [],
        papers: [
          {
            path: '/old/papers/a.pdf',
            sourcePath: '/old/papers/imports/a.pdf',
            title: 'A'
          },
          { path: '/elsewhere/b.pdf' }
        ]
      },
      '/old/papers',
      '/new/papers'
    )

    expect(result.changed).toBe(true)
    expect(result.value).toEqual({
      spaces: [],
      papers: [
        {
          path: '/new/papers/a.pdf',
          sourcePath: '/new/papers/imports/a.pdf',
          title: 'A'
        },
        { path: '/elsewhere/b.pdf' }
      ]
    })
  })

  it('rewrites annotation keys and merges collisions', () => {
    const result = rewriteAnnotationKeys(
      {
        '/old/papers/a.pdf': [{ id: 'one' }],
        '/old/papers/b.pdf': [{ id: 'two' }],
        '/new/papers/a.pdf': [{ id: 'existing' }],
        '/elsewhere/c.pdf': [{ id: 'three' }]
      },
      '/old/papers',
      '/new/papers'
    )

    expect(result.changed).toBe(true)
    expect(result.value).toEqual({
      '/new/papers/a.pdf': [{ id: 'one' }, { id: 'existing' }],
      '/new/papers/b.pdf': [{ id: 'two' }],
      '/elsewhere/c.pdf': [{ id: 'three' }]
    })
  })
})

describe('migrateLegacyUserData', () => {
  it('moves application files and rewrites paper paths, annotations and settings', async () => {
    const paths = createUserDataPaths(userDataRoot)
    const oldPapers = join(userDataRoot, 'papers')
    const oldPaperPath = join(oldPapers, 'a.pdf')
    const oldSourcePath = join(oldPapers, 'imports', 'a.pdf')
    const externalPath = join(userDataRoot, 'external.pdf')

    await mkdir(oldPapers, { recursive: true })
    await writeFile(oldPaperPath, 'pdf')
    await writeJson(join(userDataRoot, 'library.json'), {
      spaces: [{ id: 'space-1', name: 'Reading', createdAt: 1 }],
      papers: [
        { id: 'paper-1', path: oldPaperPath, sourcePath: oldSourcePath },
        { id: 'paper-2', path: externalPath }
      ]
    })
    await writeJson(join(userDataRoot, 'annotations.json'), {
      [oldPaperPath]: [{ id: 'annotation-1' }],
      [externalPath]: [{ id: 'annotation-2' }]
    })
    await writeJson(join(userDataRoot, 'settings.json'), {
      theme: 'dark',
      ai: { profiles: [], activeId: '' },
      library: { directory: oldPapers }
    })
    await writeJson(join(userDataRoot, 'plugins.json'), { enabled: {} })
    await mkdir(join(userDataRoot, 'plugins', 'demo'), { recursive: true })

    const result = await migrateLegacyUserData(userDataRoot)

    expect(result.migrated).toEqual([
      'library.json',
      'annotations.json',
      'settings.json',
      'plugins.json',
      'papers',
      'plugins'
    ])
    expect(result.skipped).toEqual([])
    await expect(access(oldPaperPath)).rejects.toThrow()
    await expect(access(join(paths.papersDirectory, 'a.pdf'))).resolves.toBeUndefined()
    await expect(access(paths.pluginsDirectory)).resolves.toBeUndefined()

    expect(await readJson(paths.libraryFile)).toEqual({
      spaces: [{ id: 'space-1', name: 'Reading', createdAt: 1 }],
      papers: [
        {
          id: 'paper-1',
          path: join(paths.papersDirectory, 'a.pdf'),
          sourcePath: join(paths.papersDirectory, 'imports', 'a.pdf')
        },
        { id: 'paper-2', path: externalPath }
      ]
    })
    expect(await readJson(paths.annotationsFile)).toEqual({
      [join(paths.papersDirectory, 'a.pdf')]: [{ id: 'annotation-1' }],
      [externalPath]: [{ id: 'annotation-2' }]
    })
    expect(await readJson(paths.settingsFile)).toEqual({
      theme: 'dark',
      ai: { profiles: [], activeId: '' },
      library: { directory: paths.papersDirectory }
    })
    expect(await readJson(paths.pluginsStateFile)).toEqual({ enabled: {} })
  })

  it('creates the data directory when there is nothing to migrate', async () => {
    const paths = createUserDataPaths(userDataRoot)

    const result = await migrateLegacyUserData(userDataRoot)

    expect(result).toEqual({ migrated: [], skipped: [] })
    await expect(access(paths.dataRoot)).resolves.toBeUndefined()
  })

  it('is idempotent and leaves already rewritten data untouched', async () => {
    const paths = createUserDataPaths(userDataRoot)
    const oldPapers = join(userDataRoot, 'papers')
    await mkdir(oldPapers, { recursive: true })
    await writeJson(join(userDataRoot, 'library.json'), {
      spaces: [],
      papers: [{ path: join(oldPapers, 'a.pdf') }]
    })

    await migrateLegacyUserData(userDataRoot)
    const first = await readFile(paths.libraryFile, 'utf8')
    const secondResult = await migrateLegacyUserData(userDataRoot)

    expect(secondResult).toEqual({ migrated: [], skipped: [] })
    expect(await readFile(paths.libraryFile, 'utf8')).toBe(first)
  })

  it('does not overwrite files already present in the data directory', async () => {
    const paths = createUserDataPaths(userDataRoot)
    await writeJson(join(userDataRoot, 'settings.json'), { marker: 'legacy' })
    await writeJson(paths.settingsFile, { marker: 'current' })

    const result = await migrateLegacyUserData(userDataRoot)

    expect(result.skipped).toEqual(['settings.json'])
    expect(await readJson(paths.settingsFile)).toEqual({ marker: 'current' })
    expect(await readJson(join(userDataRoot, 'settings.json'))).toEqual({ marker: 'legacy' })
  })

  it('keeps malformed JSON as-is instead of losing the only copy', async () => {
    const paths = createUserDataPaths(userDataRoot)
    const oldPapers = join(userDataRoot, 'papers')
    const broken = '{ not json'
    await mkdir(oldPapers, { recursive: true })
    await writeFile(join(userDataRoot, 'library.json'), broken, 'utf8')

    await migrateLegacyUserData(userDataRoot)

    expect(await readFile(paths.libraryFile, 'utf8')).toBe(broken)
  })
})
