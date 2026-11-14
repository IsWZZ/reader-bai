import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAnnotationStore,
  normalizeAnnotationMap,
  parsePaperAnnotation,
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

  it('drops malformed annotations instead of failing the whole file', async () => {
    await writeFile(
      annotationsFile,
      JSON.stringify({
        '/papers/attention.pdf': [highlight, { ...highlight, id: 'bad', page: 0 }],
        '/papers/other.pdf': 'not a list'
      }),
      'utf-8'
    )

    const store = createAnnotationStore(annotationsFile)

    await expect(store.read()).resolves.toEqual({ '/papers/attention.pdf': [highlight] })
  })

  it('removes every annotation of one paper without touching other papers', async () => {
    const store = createAnnotationStore(annotationsFile)
    await store.write({
      '/papers/attention.pdf': [highlight],
      '/papers/bert.pdf': [{ ...highlight, id: 'b1' }]
    })

    await store.removePaper('/papers/attention.pdf')

    await expect(store.read()).resolves.toEqual({
      '/papers/bert.pdf': [{ ...highlight, id: 'b1' }]
    })
  })

  it('leaves the store unchanged when the paper has no annotations', async () => {
    const store = createAnnotationStore(annotationsFile)
    await store.write({ '/papers/bert.pdf': [highlight] })

    await store.removePaper('/papers/attention.pdf')

    await expect(store.read()).resolves.toEqual({ '/papers/bert.pdf': [highlight] })
  })
})

describe('parsePaperAnnotation', () => {
  it('normalizes a valid annotation', () => {
    expect(parsePaperAnnotation({ ...highlight, id: ' a1 ', color: ' #FFEB3B ' })).toEqual({
      ...highlight,
      id: 'a1',
      color: '#FFEB3B'
    })
  })

  it('rejects malformed ids, types, colors, pages, text and rects', () => {
    const invalid: Record<string, unknown>[] = [
      { id: '' },
      { id: 'x'.repeat(101) },
      { type: 'note' },
      { color: 'yellow' },
      { color: '#12' },
      { color: '#123456789' },
      { page: 0 },
      { page: 1.5 },
      { page: '1' },
      { text: 42 },
      { text: 'x'.repeat(20_001) },
      { createdAt: 'yesterday' },
      { rects: [] },
      { rects: [{ x: -0.1, y: 0, width: 1, height: 0.1 }] },
      { rects: [{ x: 0, y: 0, width: 0, height: 0.1 }] },
      { rects: [{ x: 0, y: 0, width: 1 }] },
      { rects: [null] },
      { rects: Array.from({ length: 501 }, () => highlight.rects[0]) }
    ]

    for (const patch of invalid) {
      expect(
        () => parsePaperAnnotation({ ...highlight, ...patch }),
        JSON.stringify(patch)
      ).toThrow()
    }
  })

  it('rejects non-object annotations', () => {
    expect(() => parsePaperAnnotation(null)).toThrow('标注格式不正确')
    expect(() => parsePaperAnnotation([])).toThrow('标注格式不正确')
    expect(() => parsePaperAnnotation('highlight')).toThrow('标注格式不正确')
  })
})

describe('normalizeAnnotationMap', () => {
  it('keeps valid entries and caps the number of annotations per paper', () => {
    const many = Array.from({ length: 5_001 }, (_, index) => ({
      ...highlight,
      id: `a-${index}`
    }))
    const result = normalizeAnnotationMap({
      '/papers/attention.pdf': many,
      '/papers/broken.pdf': 'nope'
    })

    expect(result['/papers/attention.pdf']).toHaveLength(5_000)
    expect(result['/papers/broken.pdf']).toBeUndefined()
  })

  it('returns an empty map for non-object input', () => {
    expect(normalizeAnnotationMap(null)).toEqual({})
    expect(normalizeAnnotationMap([])).toEqual({})
    expect(normalizeAnnotationMap('x')).toEqual({})
  })
})
