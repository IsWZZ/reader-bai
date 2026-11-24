import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createUserDataDir,
  launchReader,
  openPaper,
  readJsonFile,
  removeUserDataDir,
  seedLibrary,
  writeSamplePdf
} from './helpers'

interface StoredAnnotation {
  id: string
  type: 'highlight' | 'underline'
  color: string
  page: number
  text: string
  rects: { x: number; y: number; width: number; height: number }[]
}

type StoredAnnotations = Record<string, StoredAnnotation[]>

let userDataDir: string

test.beforeEach(async () => {
  userDataDir = await createUserDataDir()
})

test.afterEach(async () => {
  await removeUserDataDir(userDataDir)
})

const annotationsFile = (): string => join(userDataDir, 'Userdata', 'annotations.json')
const readAnnotations = (): Promise<StoredAnnotations | null> =>
  readJsonFile<StoredAnnotations>(annotationsFile())

const seedPaper = async (): Promise<string> => {
  const pdfPath = join(userDataDir, 'sample.pdf')
  await writeSamplePdf(pdfPath)
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Sample Paper', path: pdfPath, titleSource: 'user' }]
  })
  return pdfPath
}

/** 单击文字层里的某个单词，触发阅读器的选词逻辑。 */
const clickWord = async (page: Page, firstPage: Locator, word: string): Promise<void> => {
  const span = firstPage.locator('.pdf-text-layer span').filter({ hasText: word }).first()
  await expect(span).toBeVisible()
  const box = await span.boundingBox()
  if (!box) throw new Error(`未找到 “${word}” 的文字层位置`)
  await page.mouse.click(box.x + 6, box.y + box.height / 2)
}

const annotationOverlays = (firstPage: Locator): Locator =>
  firstPage.locator('[data-annotation-type]')

test('zooms in, resets to fit width, and clamps at the minimum', async () => {
  await seedPaper()
  const reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Sample Paper')

  await expect(reader.page.getByText('100%')).toBeVisible()

  await reader.page.getByRole('button', { name: '放大' }).click()
  await expect(reader.page.getByText('120%')).toBeVisible()

  await reader.page.getByRole('button', { name: '适应宽度' }).click()
  await expect(reader.page.getByText('100%')).toBeVisible()

  const zoomOut = reader.page.getByRole('button', { name: '缩小' })
  for (let i = 0; i < 4; i += 1) {
    await zoomOut.click()
  }
  await expect(reader.page.getByText('50%')).toBeVisible()
  await expect(zoomOut).toBeDisabled()

  await reader.app.close()
})

test('navigates the paper by page number and previous/next buttons', async () => {
  const pdfPath = join(userDataDir, 'multi-page.pdf')
  await writeSamplePdf(pdfPath, undefined, 3)
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Multi Page Paper', path: pdfPath, titleSource: 'user' }]
  })

  const reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Multi Page Paper')

  const pageInput = reader.page.getByRole('textbox', { name: '页码' })
  const previous = reader.page.getByRole('button', { name: '上一页' })
  const next = reader.page.getByRole('button', { name: '下一页' })

  // 信息面板自动打开时阅读区较窄，仍应从第 1 页开始
  await expect(pageInput).toHaveValue('1')

  // 关掉信息面板，给多页 PDF 留出可滚动的阅读高度
  await reader.page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(reader.page.getByRole('complementary', { name: '论文信息' })).toBeHidden()

  await expect(pageInput).toHaveValue('1')
  await expect(previous).toBeDisabled()
  await expect(next).toBeEnabled()

  // 输入页码后回车跳页
  await pageInput.fill('3')
  await pageInput.press('Enter')
  await expect(pageInput).toHaveValue('3')
  await expect(reader.page.locator('[data-page="3"] canvas')).toBeVisible()
  await expect(next).toBeDisabled()

  // 上一页按钮逐页回退
  await previous.click()
  await expect(pageInput).toHaveValue('2')
  await expect(reader.page.locator('[data-page="2"] canvas')).toBeVisible()

  await next.click()
  await expect(pageInput).toHaveValue('3')

  // 手动滚回顶部时，当前页码跟随可视区域变化
  await reader.page.locator('[data-page="1"]').evaluate((element) => {
    const container = element.parentElement?.parentElement
    if (container) container.scrollTop = 0
  })
  await expect(pageInput).toHaveValue('1')

  // 越界和非法输入夹到有效范围
  await pageInput.fill('99')
  await pageInput.press('Enter')
  await expect(pageInput).toHaveValue('3')

  await pageInput.fill('0')
  await pageInput.press('Enter')
  await expect(pageInput).toHaveValue('1')
  await expect(previous).toBeDisabled()

  await pageInput.fill('abc')
  await pageInput.press('Enter')
  await expect(pageInput).toHaveValue('1')

  await reader.app.close()
})

test('keeps recently opened papers in tabs and preserves reader state', async () => {
  const firstPath = join(userDataDir, 'first.pdf')
  const secondPath = join(userDataDir, 'second.pdf')
  await writeSamplePdf(firstPath)
  await writeSamplePdf(secondPath)
  await seedLibrary(userDataDir, {
    papers: [
      { id: 'paper-1', title: 'First Paper', path: firstPath, titleSource: 'user' },
      { id: 'paper-2', title: 'Second Paper', path: secondPath, titleSource: 'user' }
    ]
  })

  const reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'First Paper')
  await reader.page.getByRole('button', { name: '放大' }).click()
  await expect(reader.page.getByText('120%')).toBeVisible()

  // 从书库打开第二篇，第一篇的标签仍保留在阅读区
  await openPaper(reader.page, 'Second Paper')
  await expect(reader.page.getByRole('tab')).toHaveCount(2)
  // 两个阅读器都保持挂载，但只有当前面板可见（隐藏面板不在无障碍树里）
  await expect(reader.page.locator('[role="tabpanel"]')).toHaveCount(2)
  await expect(reader.page.locator('[role="tabpanel"]:visible')).toHaveCount(1)
  await expect(reader.page.getByRole('tab', { name: 'Second Paper' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(reader.page.getByText('100%')).toBeVisible()

  // 切回第一篇时阅读器保持挂载，缩放状态不会重置
  await reader.page.getByRole('tab', { name: 'First Paper' }).click()
  await expect(reader.page.getByRole('tab', { name: 'First Paper' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(reader.page.getByText('120%')).toBeVisible()

  // 关闭当前标签后自动切到相邻论文
  await reader.page.getByRole('button', { name: '关闭 First Paper' }).click()
  await expect(reader.page.getByRole('tab')).toHaveCount(1)
  await expect(reader.page.getByRole('tab', { name: 'Second Paper' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(reader.page.getByText('100%')).toBeVisible()

  await reader.page.getByRole('button', { name: '关闭 Second Paper' }).click()
  await expect(reader.page.getByRole('tab')).toHaveCount(0)
  // 关闭最后一篇后阅读区整体收起
  await expect(reader.page.locator('main')).toHaveCount(0)

  await reader.app.close()
})

test('highlights a selected word, persists it, and removes it', async () => {
  const pdfPath = await seedPaper()
  const reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Sample Paper')

  const firstPage = reader.page.locator('[data-page="1"]')
  const highlightButton = reader.page.getByRole('button', { name: '高亮' })
  await expect(highlightButton).toBeDisabled()

  await clickWord(reader.page, firstPage, 'Hello')
  await expect(highlightButton).toBeEnabled()
  await highlightButton.click()

  await expect(annotationOverlays(firstPage)).toHaveCount(1)
  await expect(firstPage.locator('[data-annotation-type="highlight"]')).toHaveCount(1)
  await expect.poll(async () => (await readAnnotations())?.[pdfPath]?.length).toBe(1)

  const [stored] = (await readAnnotations())?.[pdfPath] ?? []
  expect(stored).toMatchObject({ type: 'highlight', page: 1, text: 'Hello' })
  expect(stored?.rects.length).toBeGreaterThan(0)
  expect(stored?.rects[0]).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number),
    width: expect.any(Number),
    height: expect.any(Number)
  })
  // 归一化坐标必须落在页面内
  expect(stored?.rects[0]?.x).toBeGreaterThanOrEqual(0)
  expect(stored?.rects[0]?.x).toBeLessThanOrEqual(1)
  expect(stored?.rects[0]?.y).toBeGreaterThanOrEqual(0)
  expect(stored?.rects[0]?.y).toBeLessThanOrEqual(1)

  await reader.app.close()

  // 重启后注释从 annotations.json 回填
  const relaunched = await launchReader(userDataDir)
  await openPaper(relaunched.page, 'Sample Paper')
  const persistedPage = relaunched.page.locator('[data-page="1"]')
  await expect(annotationOverlays(persistedPage)).toHaveCount(1)

  const eraseButton = relaunched.page.getByRole('button', { name: '取消标记' })
  await expect(eraseButton).toBeDisabled()
  await clickWord(relaunched.page, persistedPage, 'Hello')
  await expect(eraseButton).toBeEnabled()
  await eraseButton.click()

  await expect(annotationOverlays(persistedPage)).toHaveCount(0)
  await expect.poll(async () => (await readAnnotations())?.[pdfPath]?.length).toBe(0)

  await relaunched.app.close()
})

test('underlines a selected word with its own color and restores it after relaunch', async () => {
  const pdfPath = await seedPaper()
  const reader = await launchReader(userDataDir)
  await openPaper(reader.page, 'Sample Paper')

  const firstPage = reader.page.locator('[data-page="1"]')
  const underlineButton = reader.page.getByRole('button', { name: '下划线' })
  await expect(underlineButton).toBeDisabled()

  await clickWord(reader.page, firstPage, 'Hello')
  await expect(underlineButton).toBeEnabled()
  await underlineButton.click()

  // 下划线与高亮使用不同的 type 和颜色，不会互相混淆
  await expect(firstPage.locator('[data-annotation-type="underline"]')).toHaveCount(1)
  await expect(firstPage.locator('[data-annotation-type="highlight"]')).toHaveCount(0)
  await expect.poll(async () => (await readAnnotations())?.[pdfPath]?.length).toBe(1)

  const [stored] = (await readAnnotations())?.[pdfPath] ?? []
  expect(stored).toMatchObject({ type: 'underline', color: '#ef4444', page: 1, text: 'Hello' })

  await reader.app.close()

  const relaunched = await launchReader(userDataDir)
  await openPaper(relaunched.page, 'Sample Paper')
  await expect(
    relaunched.page.locator('[data-page="1"] [data-annotation-type="underline"]')
  ).toHaveCount(1)
  await relaunched.app.close()
})

test('shows an error instead of a blank page when the PDF cannot be parsed', async () => {
  const brokenPath = join(userDataDir, 'broken.pdf')
  await writeFile(brokenPath, 'this is not a PDF file')
  await seedLibrary(userDataDir, {
    papers: [{ id: 'paper-1', title: 'Broken Paper', path: brokenPath, titleSource: 'user' }]
  })

  const reader = await launchReader(userDataDir)
  await reader.page.getByRole('button', { name: 'Broken Paper', exact: true }).click()

  const alert = reader.page.getByRole('alert')
  await expect(alert).toBeVisible()
  await expect(alert).not.toHaveText('')
  // 出错时不应留下半渲染的页面或加载提示
  await expect(reader.page.locator('[data-page="1"] canvas')).toHaveCount(0)
  await expect(reader.page.getByText('正在加载论文…')).toHaveCount(0)

  await reader.app.close()
})

test('rejects annotations for papers that are not in the library', async () => {
  const pdfPath = await seedPaper()
  const reader = await launchReader(userDataDir)

  const results = await reader.page.evaluate(async (paperPath) => {
    const api = (
      globalThis as unknown as {
        api: {
          addAnnotation: (path: string, annotation: unknown) => Promise<unknown>
          listAnnotations: (path: string) => Promise<unknown>
          removeAnnotations: (path: string, ids: unknown) => Promise<unknown>
        }
      }
    ).api
    const annotation = {
      id: 'a-1',
      type: 'highlight',
      color: '#facc15',
      page: 1,
      rects: [{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }],
      text: 'Hello',
      createdAt: Date.now()
    }
    const messages: string[] = []
    for (const call of [
      () => api.addAnnotation('/tmp/not-in-library.pdf', annotation),
      () => api.removeAnnotations('/tmp/not-in-library.pdf', ['a-1']),
      () => api.listAnnotations('/tmp/not-in-library.pdf'),
      () => api.addAnnotation(paperPath, { ...annotation, type: 'note' }),
      () => api.addAnnotation(paperPath, { ...annotation, rects: [{ x: -1, y: 0 }] }),
      () => api.removeAnnotations(paperPath, 'a-1')
    ]) {
      try {
        await call()
        messages.push('')
      } catch (error) {
        messages.push(String(error))
      }
    }
    return messages
  }, pdfPath)

  expect(results[0]).toContain('Paper not found in library')
  expect(results[1]).toContain('Paper not found in library')
  expect(results[2]).toContain('Paper not found in library')
  // 格式非法的标注和 id 列表在写库前被拒绝
  expect(results[3]).toContain('标注类型不正确')
  expect(results[4]).toContain('标注坐标')
  expect(results[5]).toContain('标注 id 列表不正确')
  expect(results.every((message) => message !== '')).toBe(true)
  expect(await readAnnotations()).toBeNull()

  // 论文已在库中时列表接口可以正常返回
  const listed = await reader.page.evaluate(async (paperPath) => {
    const api = (
      globalThis as unknown as { api: { listAnnotations: (path: string) => Promise<unknown> } }
    ).api
    return api.listAnnotations(paperPath)
  }, pdfPath)
  expect(listed).toEqual([])

  await reader.app.close()
})
