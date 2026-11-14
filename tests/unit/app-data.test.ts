import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildUninstallDialogDetail,
  buildUninstallDialogOptions,
  clearAppData,
  managedPaperFiles,
  UNINSTALL_DIALOG_MESSAGE,
  UNINSTALL_DIALOG_TITLE
} from '../../src/main/app-data'

let root: string
let dataRoot: string
let libraryDirectory: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-bai-app-data-'))
  dataRoot = join(root, 'Userdata')
  libraryDirectory = join(root, 'papers')
  await mkdir(dataRoot, { recursive: true })
  await mkdir(libraryDirectory, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe('managedPaperFiles', () => {
  it('keeps only registered files inside the library directory', () => {
    const inside = join(libraryDirectory, 'a.pdf')
    const nested = join(libraryDirectory, 'nested', 'b.pdf')
    const outside = join(root, 'original.pdf')

    expect(
      managedPaperFiles(libraryDirectory, [inside, nested, outside, inside, '', undefined as never])
    ).toEqual([inside, nested])
  })

  it('does not treat the library directory itself as a paper file', () => {
    expect(managedPaperFiles(libraryDirectory, [libraryDirectory])).toEqual([])
  })
})

describe('clearAppData', () => {
  it('deletes registered paper copies and the whole data directory', async () => {
    const paper = join(libraryDirectory, 'paper.pdf')
    const unrelated = join(libraryDirectory, 'notes.txt')
    const original = join(root, 'original.pdf')
    await writeFile(paper, 'paper')
    await writeFile(unrelated, 'keep me')
    await writeFile(original, 'original')
    await writeFile(join(dataRoot, 'library.json'), '{}')
    await writeFile(join(dataRoot, 'settings.json'), '{}')

    const deleted = await clearAppData({
      dataRoot,
      libraryDirectory,
      paperPaths: [paper, original]
    })

    // 论文副本删除，dataRoot 整体删除；原始 PDF 和目录里的其他文件保留
    expect(deleted).toBe(1)
    expect(await exists(dataRoot)).toBe(false)
    expect(await exists(paper)).toBe(false)
    expect(await exists(original)).toBe(true)
    expect(await exists(unrelated)).toBe(true)
  })

  it('skips missing files and symlinks without failing', async () => {
    const target = join(root, 'target.pdf')
    const link = join(libraryDirectory, 'link.pdf')
    await writeFile(target, 'target')
    await symlink(target, link)

    const deleted = await clearAppData({
      dataRoot,
      libraryDirectory,
      paperPaths: [join(libraryDirectory, 'missing.pdf'), link]
    })

    expect(deleted).toBe(0)
    expect(await exists(dataRoot)).toBe(false)
    // 符号链接指向的文件不能被误删
    expect(await exists(target)).toBe(true)
  })

  it('tolerates a missing data directory', async () => {
    await rm(dataRoot, { recursive: true, force: true })

    await expect(clearAppData({ dataRoot, libraryDirectory, paperPaths: [] })).resolves.toBe(0)
  })
})

describe('uninstall confirmation', () => {
  const summary = { paperCount: 3, libraryDirectory: '/home/user/papers' }

  it('warns that local papers, annotations, settings and keys will be deleted', () => {
    const detail = buildUninstallDialogDetail(summary)

    expect(detail).toContain('本地保存的论文副本（当前 3 篇）')
    expect(detail).toContain('标注、设置、API Key 和插件')
    expect(detail).toContain('/home/user/papers')
    expect(detail).toContain('导入前的原始 PDF 不会被删除')
    expect(detail).toContain('不可撤销')
  })

  it('defaults to canceling the dialog', () => {
    const options = buildUninstallDialogOptions(summary)

    expect(options.type).toBe('warning')
    expect(options.buttons).toEqual(['取消', '卸载并清除'])
    expect(options.defaultId).toBe(0)
    expect(options.cancelId).toBe(0)
    expect(options.title).toBe(UNINSTALL_DIALOG_TITLE)
    expect(options.message).toBe(UNINSTALL_DIALOG_MESSAGE)
  })
})
