import { expect, test } from '@playwright/test'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUserDataDir, launchReader, removeUserDataDir, writeSamplePdf } from './helpers'

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

test('moves legacy userData files into the data directory on startup', async () => {
  const legacyPapers = join(userDataDir, 'papers')
  const legacyPdf = join(legacyPapers, 'sample.pdf')
  await mkdir(legacyPapers, { recursive: true })
  await writeSamplePdf(legacyPdf)

  await writeFile(
    join(userDataDir, 'library.json'),
    JSON.stringify({
      spaces: [],
      papers: [
        {
          id: 'paper-1',
          title: 'Legacy Paper',
          path: legacyPdf,
          fileName: 'sample.pdf',
          spaceId: null,
          titleSource: 'user',
          createdAt: Date.now()
        }
      ]
    }),
    'utf8'
  )
  await writeFile(
    join(userDataDir, 'annotations.json'),
    JSON.stringify({
      [legacyPdf]: [
        {
          id: 'annotation-1',
          type: 'highlight',
          color: '#facc15',
          page: 1,
          rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.02 }],
          text: 'Hello',
          createdAt: 1
        }
      ]
    }),
    'utf8'
  )
  await writeFile(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      theme: 'light',
      ai: { profiles: [], activeId: '' },
      library: { directory: legacyPapers }
    }),
    'utf8'
  )

  const { app, page } = await launchReader(userDataDir)

  await expect(page.getByRole('button', { name: 'Legacy Paper', exact: true })).toBeVisible()

  const dataRoot = join(userDataDir, 'data')
  const storedPdf = join(dataRoot, 'papers', 'sample.pdf')
  await expect(access(legacyPdf)).rejects.toThrow()
  await expect(access(storedPdf)).resolves.toBeUndefined()
  await expect(access(join(userDataDir, 'library.json'))).rejects.toThrow()

  const library = JSON.parse(await readFile(join(dataRoot, 'library.json'), 'utf8')) as {
    papers: { path: string }[]
  }
  expect(library.papers[0]?.path).toBe(storedPdf)

  const annotations = JSON.parse(
    await readFile(join(dataRoot, 'annotations.json'), 'utf8')
  ) as Record<string, unknown[]>
  expect(annotations[storedPdf]).toHaveLength(1)

  const settings = JSON.parse(await readFile(join(dataRoot, 'settings.json'), 'utf8')) as {
    library: { directory: string }
  }
  expect(settings.library.directory).toBe(join(dataRoot, 'papers'))

  await app.close()
})
