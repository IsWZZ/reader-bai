import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAnnotationStore,
  type AnnotationMap,
  type PaperAnnotation
} from '../../src/main/annotations'

let dir: string
let annotationsFile: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reader-bai-annotations-'))
  annotationsFile = join(dir, 'annotations.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const highlight: PaperAnnotation = {
  id: 'a1',
  type: 'highlight',
  color: '#ffeb3b',
  page: 1,
  rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }],
  text: 'attention is all you need',
  createdAt: 1
}

describe('createAnnotationStore', () => {
  it('returns an empty store when the file does not exist', async () => {
    const store = createAnnotationStore(annotationsFile)
    await expect(store.read()).resolves.toEqual({})
  })

  it('returns an empty store when the file is corrupted', async () => {
    await writeFile(annotationsFile, 'not json', 'utf-8')
    const store = createAnnotationStore(annotationsFile)
    await expect(store.read()).resolves.toEqual({})
  })

  it('round-trips annotations keyed by paper path', async () => {
    const store = createAnnotationStore(annotationsFile)
    const data: AnnotationMap = { '/papers/attention.pdf': [highlight] }

    await store.write(data)

    await expect(store.read()).resolves.toEqual(data)
  })
})
