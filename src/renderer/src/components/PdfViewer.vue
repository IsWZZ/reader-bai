<template>
  <div class="flex h-full w-full flex-col">
    <!-- 工具栏 -->
    <TooltipProvider :delay-duration="300">
      <div class="flex shrink-0 items-center gap-1 pb-2">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="缩小"
              :disabled="zoom <= MIN_ZOOM"
              @click="stepZoom(-1)"
            >
              <ZoomOut class="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>缩小</TooltipContent>
        </Tooltip>
        <span class="w-12 text-center text-xs tabular-nums text-muted-foreground">
          {{ zoomPercent }}%
        </span>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="放大"
              :disabled="zoom >= MAX_ZOOM"
              @click="stepZoom(1)"
            >
              <ZoomIn class="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>放大</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="适应宽度" @click="resetZoom">
              <Scan class="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>适应宽度</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" class="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="高亮"
              :disabled="!pendingSelection"
              @mousedown.prevent
              @click="applyAnnotation('highlight')"
            >
              <Highlighter class="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>高亮</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="下划线"
              :disabled="!pendingSelection"
              @mousedown.prevent
              @click="applyAnnotation('underline')"
            >
              <Underline class="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>下划线</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="取消标记"
              :disabled="removableAnnotations.length === 0"
              @mousedown.prevent
              @click="removeSelectedAnnotations"
            >
              <Eraser class="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>取消标记</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>

    <div ref="containerRef" class="relative flex-1 overflow-auto rounded-lg bg-muted/30">
      <!-- 加载状态 -->
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center">
        <p class="text-sm text-muted-foreground">正在加载论文…</p>
      </div>

      <!-- 错误状态 -->
      <div
        v-else-if="error"
        class="absolute inset-0 flex items-center justify-center p-6 text-center"
      >
        <p class="text-sm text-destructive">{{ error }}</p>
      </div>

      <!-- PDF 页面（懒渲染：只渲染可视区域附近的页） -->
      <div v-else class="flex flex-col gap-4 p-4">
        <div
          v-for="pageNumber in pageCount"
          :key="pageNumber"
          :data-page="pageNumber"
          dir="ltr"
          class="relative mx-auto w-max bg-white shadow-md"
        >
          <canvas
            :ref="(el) => setCanvasRef(pageNumber, el as HTMLCanvasElement | null)"
            class="block"
          />
          <div
            :ref="(el) => setTextLayerRef(pageNumber, el as HTMLDivElement | null)"
            class="pdf-text-layer"
          />
          <div class="pointer-events-none absolute inset-0 z-10">
            <template v-for="annotation in annotationsForPage(pageNumber)" :key="annotation.id">
              <div
                v-for="(rect, index) in annotation.rects"
                :key="`${annotation.id}-${index}`"
                class="absolute"
                :data-annotation-id="annotation.id"
                :data-annotation-type="annotation.type"
                :style="annotationRectStyle(annotation, rect)"
              />
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist'
import { pdfjsLib } from '@renderer/lib/pdf'
import { Button } from '@renderer/components/ui/button'
import { Separator } from '@renderer/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { Eraser, Highlighter, Scan, Underline, ZoomIn, ZoomOut } from 'lucide-vue-next'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 1.2

// 与主进程/ preload 中的注释结构保持一致
interface AnnotationRect {
  x: number
  y: number
  width: number
  height: number
}

interface PaperAnnotation {
  id: string
  type: 'highlight' | 'underline'
  color: string
  page: number
  rects: AnnotationRect[]
  text: string
  createdAt: number
}

const props = defineProps<{
  /** 论文在磁盘上的绝对路径 */
  src: string
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const pageCount = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)

// 缩放倍率，1 表示适应容器宽度
const zoom = ref(1)
const zoomPercent = computed(() => Math.round(zoom.value * 100))

// 当前已划选的文本，等待用户点击高亮/下划线
const pendingSelection = ref<{
  pageNumber: number
  rects: AnnotationRect[]
  text: string
} | null>(null)

const annotations = ref<PaperAnnotation[]>([])

let pdfDoc: PDFDocumentProxy | null = null
// 每次切换文档或重新布局时递增，过期任务据此丢弃
let generation = 0
// 容器内基础宽度（未乘缩放倍率）
let availableWidth = 0

const canvasRefs = new Map<number, HTMLCanvasElement>()
const textLayerRefs = new Map<number, HTMLDivElement>()
// 每页在 scale=1 时的尺寸，用于占位高度和缩放计算
const pageSizes = new Map<number, { width: number; height: number }>()
// 每页最近一次渲染时使用的宽度，宽度没变就不重复渲染
const renderedWidths = new Map<number, number>()
const pageTasks = new Map<number, RenderTask>()
const textLayers = new Map<number, TextLayer>()
// 所有页面共用一条渲染队列，避免多页同时绘制抢占主线程
let renderQueue: Promise<void> = Promise.resolve()

let intersectionObserver: IntersectionObserver | null = null

const annotationsByPage = computed(() => {
  const map = new Map<number, PaperAnnotation[]>()
  for (const annotation of annotations.value) {
    const list = map.get(annotation.page)
    if (list) {
      list.push(annotation)
    } else {
      map.set(annotation.page, [annotation])
    }
  }
  return map
})

const annotationsForPage = (pageNumber: number): PaperAnnotation[] =>
  annotationsByPage.value.get(pageNumber) ?? []

const annotationRectStyle = (
  annotation: PaperAnnotation,
  rect: AnnotationRect
): Record<string, string> => {
  const style: Record<string, string> = {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`
  }
  if (annotation.type === 'highlight') {
    style.backgroundColor = `${annotation.color}66`
    style.mixBlendMode = 'multiply'
    style.borderRadius = '2px'
  } else {
    style.borderBottom = `2px solid ${annotation.color}`
  }
  return style
}

const setCanvasRef = (pageNumber: number, el: HTMLCanvasElement | null): void => {
  if (el) {
    canvasRefs.set(pageNumber, el)
  } else {
    canvasRefs.delete(pageNumber)
  }
}

const setTextLayerRef = (pageNumber: number, el: HTMLDivElement | null): void => {
  if (el) {
    textLayerRefs.set(pageNumber, el)
  } else {
    textLayerRefs.delete(pageNumber)
  }
}

const computeAvailableWidth = (): number =>
  Math.max((containerRef.value?.clientWidth ?? 0) - 32, 200)

// 当前实际渲染宽度（基础宽度 × 缩放倍率）
const currentPageWidth = (): number => Math.max(1, Math.round(availableWidth * zoom.value))

// 用已知的页面比例更新 canvas 的占位尺寸（不涉及像素渲染，成本很低）
const applyCanvasSize = (pageNumber: number, canvas: HTMLCanvasElement): void => {
  const size = pageSizes.get(pageNumber)
  const width = currentPageWidth()
  if (!size || !availableWidth) return
  canvas.style.width = `${width}px`
  canvas.style.height = `${Math.max(1, Math.round((size.height / size.width) * width))}px`
}

const destroyTextLayer = (pageNumber: number): void => {
  const layer = textLayers.get(pageNumber)
  if (layer) {
    textLayers.delete(pageNumber)
    try {
      layer.cancel()
    } catch {
      // ignore
    }
  }
  textLayerRefs.get(pageNumber)?.replaceChildren()
}

const clearTextLayers = (): void => {
  for (const pageNumber of [...textLayers.keys()]) {
    destroyTextLayer(pageNumber)
  }
  textLayers.clear()
}

const cancelAllRenders = async (): Promise<void> => {
  const tasks = [...pageTasks.values()]
  pageTasks.clear()
  for (const task of tasks) {
    try {
      task.cancel()
    } catch {
      // 已结束的任务 cancel 会抛异常，忽略即可
    }
  }
  await Promise.all(tasks.map((task) => task.promise.catch(() => undefined)))
}

// 在页面上叠加与 canvas 完全对齐的透明文本层，用于划词选择
const buildTextLayer = async (
  page: PDFPageProxy,
  pageNumber: number,
  viewport: ReturnType<PDFPageProxy['getViewport']>,
  currentGeneration: number
): Promise<void> => {
  const container = textLayerRefs.get(pageNumber)
  if (!container) return

  destroyTextLayer(pageNumber)
  container.style.setProperty('--total-scale-factor', String(viewport.scale))
  container.style.setProperty('--scale-round-x', '1px')
  container.style.setProperty('--scale-round-y', '1px')

  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: true }),
    container,
    viewport
  })
  textLayers.set(pageNumber, textLayer)

  try {
    await textLayer.render()
  } catch (err) {
    if (currentGeneration === generation) {
      console.error(`渲染第 ${pageNumber} 页文本层失败:`, err)
    }
  }
}

const renderPage = async (
  doc: PDFDocumentProxy,
  pageNumber: number,
  currentGeneration: number
): Promise<void> => {
  if (currentGeneration !== generation) return

  const canvas = canvasRefs.get(pageNumber)
  if (!canvas || !availableWidth) return
  const width = currentPageWidth()
  if (renderedWidths.get(pageNumber) === width) return

  // 取消并等待该页上一次渲染，避免同一个 canvas 并发渲染
  const previousTask = pageTasks.get(pageNumber)
  if (previousTask) {
    pageTasks.delete(pageNumber)
    try {
      previousTask.cancel()
    } catch {
      // ignore
    }
    await previousTask.promise.catch(() => undefined)
  }
  if (currentGeneration !== generation) return
  if (renderedWidths.get(pageNumber) === width) return

  let page: PDFPageProxy
  try {
    page = await doc.getPage(pageNumber)
  } catch (err) {
    // 切换论文时旧文档的 transport 会被销毁，属于正常情况
    if (currentGeneration === generation) {
      console.error(`读取第 ${pageNumber} 页失败:`, err)
    }
    return
  }
  if (currentGeneration !== generation) return

  const unscaledViewport = page.getViewport({ scale: 1 })
  pageSizes.set(pageNumber, {
    width: unscaledViewport.width,
    height: unscaledViewport.height
  })

  const viewport = page.getViewport({ scale: width / unscaledViewport.width })
  const outputScale = window.devicePixelRatio || 1

  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`

  const task = page.render({
    canvas,
    viewport,
    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
  })
  pageTasks.set(pageNumber, task)

  const textLayerPromise = buildTextLayer(page, pageNumber, viewport, currentGeneration)

  try {
    await task.promise
    if (currentGeneration === generation) {
      renderedWidths.set(pageNumber, width)
    }
  } catch (err) {
    if ((err as Error).name !== 'RenderingCancelledException') {
      console.error(`渲染第 ${pageNumber} 页失败:`, err)
    }
  } finally {
    if (pageTasks.get(pageNumber) === task) {
      pageTasks.delete(pageNumber)
    }
  }

  await textLayerPromise
}

const scheduleRender = (
  doc: PDFDocumentProxy,
  pageNumber: number,
  currentGeneration: number
): void => {
  if (currentGeneration !== generation) return
  renderQueue = renderQueue
    .then(() => renderPage(doc, pageNumber, currentGeneration))
    .catch(() => undefined)
}

// 渲染当前可视区域（含上下各 200px 预渲染范围）内的页面
const renderVisiblePages = (doc: PDFDocumentProxy, currentGeneration: number): void => {
  const container = containerRef.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  for (const [pageNumber, canvas] of canvasRefs) {
    const canvasRect = canvas.getBoundingClientRect()
    if (canvasRect.bottom >= rect.top - 200 && canvasRect.top <= rect.bottom + 200) {
      scheduleRender(doc, pageNumber, currentGeneration)
    }
  }
}

const setupObserver = (): void => {
  intersectionObserver?.disconnect()
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      const doc = pdfDoc
      if (!doc) return
      const currentGeneration = generation
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const target = entry.target as HTMLElement
        // 观察的是整页容器（页号存放在 [data-page] 上），canvas 本身没有页号
        const pageNumber = Number(target.closest<HTMLElement>('[data-page]')?.dataset.page)
        if (pageNumber > 0) {
          scheduleRender(doc, pageNumber, currentGeneration)
        }
      }
    },
    { root: containerRef.value, rootMargin: '200px 0px' }
  )
  for (const canvas of canvasRefs.values()) {
    intersectionObserver.observe(canvas.closest('[data-page]') ?? canvas)
  }
}

const loadAnnotations = async (): Promise<void> => {
  if (!window.api) return
  const src = props.src
  try {
    const list = await window.api.listAnnotations(src)
    if (src === props.src) {
      // 旧数据里同一行可能有多个重叠矩形，加载时也合并一次
      annotations.value = list.map((annotation) => ({
        ...annotation,
        rects: mergeNormalizedRects(annotation.rects)
      }))
    }
  } catch (err) {
    console.error('加载注释失败:', err)
  }
}

const loadDocument = async (): Promise<void> => {
  generation += 1
  const currentGeneration = generation

  loading.value = true
  error.value = null
  pageCount.value = 0
  pendingSelection.value = null
  annotations.value = []
  pageSizes.clear()
  renderedWidths.clear()
  canvasRefs.clear()
  clearTextLayers()

  await cancelAllRenders()
  if (currentGeneration !== generation) return

  try {
    if (pdfDoc) {
      const oldDoc = pdfDoc
      pdfDoc = null
      await oldDoc.loadingTask.destroy()
      if (currentGeneration !== generation) return
    }

    if (!window.api) {
      throw new Error('window.api is not available')
    }

    const data = await window.api.readPaper(props.src)
    if (currentGeneration !== generation) return
    if (!data || data.byteLength === 0) {
      throw new Error('无法读取论文文件')
    }

    const doc = await pdfjsLib.getDocument({ data }).promise
    // 加载过程中又切换了论文，销毁这次的结果，避免覆盖当前文档
    if (currentGeneration !== generation) {
      void doc.loadingTask.destroy()
      return
    }
    pdfDoc = doc

    availableWidth = computeAvailableWidth()

    // 预先获取所有页的尺寸，保证占位高度和滚动条正确（不绘制内容）
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      if (currentGeneration !== generation) return
      try {
        const page = await doc.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1 })
        pageSizes.set(pageNumber, { width: viewport.width, height: viewport.height })
      } catch (err) {
        if (currentGeneration === generation) {
          console.error(`读取第 ${pageNumber} 页尺寸失败:`, err)
        }
      }
    }

    if (currentGeneration !== generation) return

    pageCount.value = doc.numPages
    loading.value = false

    await nextTick()
    if (currentGeneration !== generation || !containerRef.value) return

    containerRef.value.scrollTop = 0
    for (const [pageNumber, canvas] of canvasRefs) {
      applyCanvasSize(pageNumber, canvas)
    }
    setupObserver()
    renderVisiblePages(doc, currentGeneration)
  } catch (err) {
    // 过期请求的报错（如 Transport destroyed）不应影响当前论文
    if (currentGeneration !== generation) return
    console.error('加载 PDF 失败:', err)
    error.value = err instanceof Error ? err.message : '加载论文失败'
    loading.value = false
  }
}

const setZoom = async (value: number): Promise<void> => {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
  if (Math.abs(next - zoom.value) < 0.001) return
  zoom.value = next
  pendingSelection.value = null

  const doc = pdfDoc
  if (!doc || loading.value) return

  generation += 1
  const currentGeneration = generation
  await cancelAllRenders()
  if (currentGeneration !== generation) return

  for (const [pageNumber, canvas] of canvasRefs) {
    applyCanvasSize(pageNumber, canvas)
  }
  renderVisiblePages(doc, currentGeneration)
}

const stepZoom = (direction: 1 | -1): void => {
  void setZoom(direction > 0 ? zoom.value * ZOOM_STEP : zoom.value / ZOOM_STEP)
}

const resetZoom = (): void => {
  void setZoom(1)
}

// 合并同一行内相邻的选区矩形，减少覆盖层节点数量
// 同一行文字会被拆成多个矩形，且各片段高度略有差异。
// 先按垂直重叠把矩形归到同一行，再合并行内水平相邻的片段，
// 否则会出现重叠的高亮色块和下划线“双线”。
const mergeNormalizedRects = (rects: AnnotationRect[]): AnnotationRect[] => {
  const lines: { top: number; bottom: number; rects: AnnotationRect[] }[] = []
  for (const rect of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((item) => {
      const overlap = Math.min(item.bottom, rect.y + rect.height) - Math.max(item.top, rect.y)
      const minHeight = Math.min(item.bottom - item.top, rect.height)
      return overlap > minHeight * 0.5
    })
    if (line) {
      line.top = Math.min(line.top, rect.y)
      line.bottom = Math.max(line.bottom, rect.y + rect.height)
      line.rects.push(rect)
    } else {
      lines.push({ top: rect.y, bottom: rect.y + rect.height, rects: [rect] })
    }
  }

  const merged: AnnotationRect[] = []
  for (const line of lines) {
    let left = 0
    let right = 0
    let started = false
    for (const rect of [...line.rects].sort((a, b) => a.x - b.x)) {
      if (!started) {
        left = rect.x
        right = rect.x + rect.width
        started = true
      } else if (rect.x <= right + 0.002) {
        right = Math.max(right, rect.x + rect.width)
      } else {
        merged.push({ x: left, y: line.top, width: right - left, height: line.bottom - line.top })
        left = rect.x
        right = rect.x + rect.width
      }
    }
    if (started) {
      merged.push({ x: left, y: line.top, width: right - left, height: line.bottom - line.top })
    }
  }
  return merged
}

const mergeRects = (rects: DOMRect[], pageRect: DOMRect): AnnotationRect[] => {
  if (pageRect.width === 0 || pageRect.height === 0) return []

  const normalized = rects
    .map((rect) => ({
      x: (rect.left - pageRect.left) / pageRect.width,
      y: (rect.top - pageRect.top) / pageRect.height,
      width: rect.width / pageRect.width,
      height: rect.height / pageRect.height
    }))
    .filter((rect) => rect.width > 0.001 && rect.height > 0.001)
  return mergeNormalizedRects(normalized)
}

const getSelectionOnPage = (): {
  pageNumber: number
  rects: AnnotationRect[]
  text: string
} | null => {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const startElement =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
  const endElement =
    range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement

  const startPage = startElement?.closest<HTMLElement>('[data-page]')
  const endPage = endElement?.closest<HTMLElement>('[data-page]')
  // 目前只支持同一页内的选择
  if (!startPage || startPage !== endPage) return null

  const pageNumber = Number(startPage.dataset.page)
  const text = selection.toString().trim()
  if (!pageNumber || !text) return null

  const rects = mergeRects(Array.from(range.getClientRects()), startPage.getBoundingClientRect())
  if (rects.length === 0) return null

  return { pageNumber, rects, text }
}

// ---------- 单击选词 / 双击选句 ----------

interface TextSegment {
  node: Text
  start: number
  end: number
}

// 记录按下位置，用来区分单击和拖拽划选
let pointerDownAt: { x: number; y: number } | null = null

// 鼠标位置对应的文本光标（Chromium 用 caretPositionFromPoint，旧内核用 caretRangeFromPoint）
const getCaretFromPoint = (x: number, y: number): { node: Node; offset: number } | null => {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const position = doc.caretPositionFromPoint?.(x, y)
  if (position) return { node: position.offsetNode, offset: position.offset }
  const range = doc.caretRangeFromPoint?.(x, y)
  if (range) return { node: range.startContainer, offset: range.startOffset }
  return null
}

// 只有点在 PDF 文字层上时才返回对应的文本节点
const textNodeAt = (x: number, y: number): { node: Text; offset: number } | null => {
  const caret = getCaretFromPoint(x, y)
  if (!caret || !(caret.node instanceof Text)) return null
  if (!caret.node.parentElement?.closest('.pdf-text-layer')) return null
  return { node: caret.node, offset: caret.offset }
}

const WORD_CHAR = /[\p{L}\p{N}'’_-]/u

// 选中鼠标下的单词；点在空白或标点上时取最近的单词
const selectWordAtPoint = (x: number, y: number): boolean => {
  const target = textNodeAt(x, y)
  if (!target) return false

  const content = target.node.nodeValue ?? ''
  const isWordChar = (index: number): boolean =>
    index >= 0 && index < content.length && WORD_CHAR.test(content[index])

  let index = -1
  if (isWordChar(target.offset)) {
    index = target.offset
  } else if (isWordChar(target.offset - 1)) {
    index = target.offset - 1
  } else {
    // 光标落在标点或空白上，先向右、再向左找最近的单词
    for (let i = target.offset; i < content.length; i += 1) {
      if (isWordChar(i)) {
        index = i
        break
      }
    }
    if (index === -1) {
      for (let i = target.offset - 1; i >= 0; i -= 1) {
        if (isWordChar(i)) {
          index = i
          break
        }
      }
    }
  }
  if (index === -1) return false

  let start = index
  let end = index + 1
  while (isWordChar(start - 1)) start -= 1
  while (isWordChar(end)) end += 1

  const range = document.createRange()
  range.setStart(target.node, start)
  range.setEnd(target.node, end)
  const selection = window.getSelection()
  if (!selection) return false
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

// 句号后常见的缩写，遇到时不当作句子结束
const SENTENCE_ABBREVIATIONS = new Set([
  'e.g',
  'i.e',
  'et al',
  'al',
  'fig',
  'figs',
  'eq',
  'eqs',
  'sec',
  'secs',
  'ref',
  'refs',
  'no',
  'nos',
  'vs',
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'etc',
  'approx'
])

const isSentenceEnd = (text: string, index: number): boolean => {
  const char = text[index]
  if (char === '!' || char === '?' || char === '。' || char === '！' || char === '？') return true
  if (char !== '.') return false

  const prev = text[index - 1] ?? ''
  const next = text[index + 1] ?? ''
  // 小数与编号：3.14、1.2.3
  if (/\d/.test(prev) && /[\d.]/.test(next)) return false
  // 句号后面通常是空白、行尾或收尾符号；紧贴字母数字的更像邮箱、网址或编号
  if (next && !/[\s"'”’）)\]]/.test(next)) return false

  // 缩写：e.g. / i.e. / et al. / Fig. / Eq.
  const rawWord = text.slice(0, index).match(/[A-Za-z.]+$/)?.[0] ?? ''
  if (SENTENCE_ABBREVIATIONS.has(rawWord.toLowerCase())) return false
  // 人名首字母：J. Smith；字母前必须是空白，避免把 51.6°S. 当成缩写
  if (/^\p{Lu}$/u.test(rawWord)) {
    const before = text[index - 2] ?? ''
    const after = text.slice(index + 1).match(/^\s*(\S)/)?.[1] ?? ''
    if ((before === '' || /\s/.test(before)) && after && /^\p{Lu}/u.test(after)) return false
  }
  return true
}

// 以光标位置所在句子为界，向前后找最近的句末符号；
// 文字块里用空行标记段落开头和标签分界，句子不会越过这些边界。
const sentenceRangeAt = (text: string, offset: number): [number, number] => {
  let start = 0
  for (let i = Math.min(offset, text.length) - 1; i >= 0; i -= 1) {
    if (text[i] === '\n' && text[i - 1] === '\n') {
      start = i + 1
      break
    }
    if (isSentenceEnd(text, i)) {
      start = i + 1
      break
    }
  }
  while (start < text.length && /\s/.test(text[start])) start += 1

  let end = text.length
  for (let i = Math.max(offset, 0); i < text.length; i += 1) {
    if (text[i] === '\n' && text[i + 1] === '\n') {
      end = i
      break
    }
    if (isSentenceEnd(text, i)) {
      end = i + 1
      break
    }
  }
  // 把句末的引号、括号也包含进来
  while (end < text.length && /["'”’）)\]]/.test(text[end])) end += 1
  return [start, end]
}

const positionInSegments = (
  segments: TextSegment[],
  position: number
): { node: Text; offset: number } | null => {
  if (segments.length === 0) return null
  for (const segment of segments) {
    if (position <= segment.end) {
      return { node: segment.node, offset: Math.max(0, position - segment.start) }
    }
  }
  const last = segments[segments.length - 1]
  return { node: last.node, offset: (last.node.nodeValue ?? '').length }
}

const applyRange = (range: Range): boolean => {
  const selection = window.getSelection()
  if (!selection) return false
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

const getSpanFontSize = (span: HTMLElement): number => {
  const size = Number.parseFloat(getComputedStyle(span).fontSize)
  return Number.isFinite(size) ? size : 0
}

interface LineBox {
  top: number
  bottom: number
  left: number
  right: number
  // 行内最大的字号，上标、脚注编号等小字不影响整行样式
  size: number
  spans: HTMLElement[]
}

// 把文字层里的 span 按视觉行聚合。
// 同一行内的文字垂直重叠、水平间距很小；两栏或不同块之间的间距更大，会拆成不同的行。
const buildLines = (layer: HTMLElement): LineBox[] => {
  const spans = Array.from(layer.querySelectorAll<HTMLElement>('span')).filter(
    (item) => !!item.textContent?.trim()
  )
  const lines: LineBox[] = []
  for (const span of spans) {
    const rect = span.getBoundingClientRect()
    const size = getSpanFontSize(span)
    const line = lines.find((item) => {
      const overlap = Math.min(item.bottom, rect.bottom) - Math.max(item.top, rect.top)
      if (overlap <= Math.min(item.bottom - item.top, rect.height) * 0.5) return false
      const gap = Math.max(item.left, rect.left) - Math.min(item.right, rect.right)
      return gap <= Math.max(rect.height, size) * 1.5
    })
    if (line) {
      line.top = Math.min(line.top, rect.top)
      line.bottom = Math.max(line.bottom, rect.bottom)
      line.left = Math.min(line.left, rect.left)
      line.right = Math.max(line.right, rect.right)
      line.size = Math.max(line.size, size)
      line.spans.push(span)
    } else {
      lines.push({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        size,
        spans: [span]
      })
    }
  }
  return lines
}

const sameTextStyle = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(a, b) * 0.08

const horizontallyOverlaps = (a: LineBox, b: LineBox): boolean =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0

const verticallyAdjacent = (a: LineBox, b: LineBox): boolean => {
  const gap = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)
  return gap <= Math.max(a.bottom - a.top, b.bottom - b.top) * 1.8
}

const medianLineSize = (lines: LineBox[]): number => {
  const sizes = lines.map((line) => line.size).sort((a, b) => a - b)
  return sizes[Math.floor(sizes.length / 2)] ?? 0
}

// 字号相同的行属于同一类文字；上标、脚注、标题的字号不同，会被排除在外
const linesOfStyle = (lines: LineBox[], anchor: LineBox): LineBox[] =>
  lines.filter((line) => sameTextStyle(line.size, anchor.size))

// 点击位置所在的连续同字号文字块。
// 遇到标题、作者、脚注等不同字号的内容就断开，避免选区跨过它们。
const collectBlockLines = (lines: LineBox[], index: number): LineBox[] => {
  const anchor = lines[index]
  let first = index
  let last = index
  while (first > 0 && sameTextStyle(lines[first - 1].size, anchor.size)) first -= 1
  while (last < lines.length - 1 && sameTextStyle(lines[last + 1].size, anchor.size)) last += 1
  return lines.slice(first, last + 1)
}

// 标题按垂直相邻的同字号行整块选中
const headingBlockLines = (lines: LineBox[], index: number): LineBox[] => {
  const anchor = lines[index]
  const styleLines = linesOfStyle(lines, anchor)
  const position = styleLines.indexOf(anchor)
  if (position === -1) return [anchor]

  let first = position
  let last = position
  while (
    first > 0 &&
    horizontallyOverlaps(styleLines[first - 1], styleLines[first]) &&
    verticallyAdjacent(styleLines[first - 1], styleLines[first])
  ) {
    first -= 1
  }
  while (
    last < styleLines.length - 1 &&
    horizontallyOverlaps(styleLines[last], styleLines[last + 1]) &&
    verticallyAdjacent(styleLines[last], styleLines[last + 1])
  ) {
    last += 1
  }
  return styleLines.slice(first, last + 1)
}

// 同一栏文字的左边界，用来判断段落首行缩进
const columnLeft = (lines: LineBox[], line: LineBox): number => {
  let left = line.left
  for (const item of lines) {
    if (horizontallyOverlaps(item, line)) left = Math.min(left, item.left)
  }
  return left
}

// 段落首行通常有缩进或上方留白；换栏时句子可能继续，不能算段落开头
const isParagraphStart = (lines: LineBox[], index: number): boolean => {
  if (index === 0) return false
  const line = lines[index]
  const prev = lines[index - 1]
  if (!horizontallyOverlaps(prev, line)) return false
  if (line.top - prev.bottom > line.size * 0.9) return true
  return line.left - columnLeft(lines, line) > line.size * 0.5
}

// 同行内的大间距通常是标签和正文的分界（如 Abstract、Keywords）
const labelGap = 0.75

// 把文字块内的行按阅读顺序拼成一段文本：行与行之间换行，
// 段落开头和标签之后用空行隔开，作为句子扫描的硬边界。
const buildBlockText = (lines: LineBox[]): { text: string; segments: TextSegment[] } => {
  const segments: TextSegment[] = []
  const parts: string[] = []
  let length = 0
  const push = (value: string): void => {
    if (!value) return
    parts.push(value)
    length += value.length
  }

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) push(isParagraphStart(lines, lineIndex) ? '\n\n' : '\n')
    const ordered = [...line.spans].sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
    )
    ordered.forEach((span, spanIndex) => {
      if (spanIndex > 0) {
        const prev = ordered[spanIndex - 1]
        const gap = span.getBoundingClientRect().left - prev.getBoundingClientRect().right
        // 只把短的引导词（Abstract、Keywords 等）当作标签，避免拆散正常行
        if (gap > line.size * labelGap && (prev.textContent ?? '').trim().length <= 20) {
          push('\n\n')
        } else if (gap > line.size * 0.15) {
          // pdf.js 按文字块切分 span，词间空格可能被切掉，按间距补回来
          push(' ')
        }
      }
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        const value = node.nodeValue ?? ''
        if (value) {
          segments.push({ node: node as Text, start: length, end: length + value.length })
          push(value)
        }
        node = walker.nextNode()
      }
    })
  })
  return { text: parts.join(''), segments }
}

// 选中鼠标下的单词所在的句子。
// 句子只在点击所在的文字块内查找，避免越过标题、作者、图表等区域。
const selectSentenceAtPoint = (x: number, y: number): boolean => {
  const target = textNodeAt(x, y)
  if (!target) return false
  const span = target.node.parentElement?.closest<HTMLElement>('span')
  const layer = target.node.parentElement?.closest<HTMLElement>('.pdf-text-layer')
  if (!span || !layer) return false

  const lines = buildLines(layer)
  const lineIndex = lines.findIndex((line) => line.spans.includes(span))
  if (lineIndex === -1) return false

  // 标题字号明显大于正文时整块选中；正文则在同一个文字块内查找句子
  const clickedLine = lines[lineIndex]
  const isHeading = clickedLine.size >= medianLineSize(lines) * 1.4
  const block = isHeading
    ? headingBlockLines(lines, lineIndex)
    : collectBlockLines(lines, lineIndex)
  const { text, segments } = buildBlockText(block)
  const segment = segments.find((item) => item.node === target.node)
  if (!segment) return false

  const offset = segment.start + Math.min(target.offset, (target.node.nodeValue ?? '').length)
  const [start, end] = isHeading ? [0, text.length] : sentenceRangeAt(text, offset)
  if (end <= start) return false

  const startPosition = positionInSegments(segments, start)
  const endPosition = positionInSegments(segments, end)
  if (!startPosition || !endPosition) return false

  const range = document.createRange()
  range.setStart(startPosition.node, startPosition.offset)
  range.setEnd(endPosition.node, endPosition.offset)
  return applyRange(range)
}

const handleMouseDown = (event: MouseEvent): void => {
  if (event.button !== 0) {
    pointerDownAt = null
    return
  }
  pointerDownAt = { x: event.clientX, y: event.clientY }
}

const handleMouseUp = (event: MouseEvent): void => {
  // 点击工具栏按钮时保留之前捕获的选区，否则按钮的 mouseup 会把选区清空
  if (event.target instanceof Element && event.target.closest('button')) {
    pointerDownAt = null
    return
  }
  const down = pointerDownAt
  pointerDownAt = null
  const dragged = down ? Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4 : false
  // 单击（没有拖动）选中鼠标下的单词；双击、三击交给对应的处理器
  if (!dragged && event.detail === 1) selectWordAtPoint(event.clientX, event.clientY)
  pendingSelection.value = getSelectionOnPage()
}

const handleDoubleClick = (event: MouseEvent): void => {
  if (event.target instanceof Element && event.target.closest('button')) return
  // 双击时把选中的单词扩展为所在句子
  if (!selectSentenceAtPoint(event.clientX, event.clientY)) return
  pendingSelection.value = getSelectionOnPage()
}

const rectsOverlap = (a: AnnotationRect, b: AnnotationRect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

// 当前选区覆盖到的已有标记，用于取消高亮/下划线
const removableAnnotations = computed(() => {
  const pending = pendingSelection.value
  if (!pending) return []
  return annotationsForPage(pending.pageNumber).filter((annotation) =>
    annotation.rects.some((rect) =>
      pending.rects.some((selectedRect) => rectsOverlap(rect, selectedRect))
    )
  )
})

const applyAnnotation = async (type: 'highlight' | 'underline'): Promise<void> => {
  const pending = pendingSelection.value
  if (!pending || !window.api) return

  // 相同类型、同一页且矩形完全一致的标记已经存在时不再重复添加，避免叠出更深的色块
  const isDuplicate = annotations.value.some(
    (item) =>
      item.type === type &&
      item.page === pending.pageNumber &&
      item.text === pending.text &&
      item.rects.length === pending.rects.length &&
      item.rects.every(
        (rect, index) =>
          Math.abs(rect.x - pending.rects[index].x) < 0.001 &&
          Math.abs(rect.y - pending.rects[index].y) < 0.001 &&
          Math.abs(rect.width - pending.rects[index].width) < 0.001 &&
          Math.abs(rect.height - pending.rects[index].height) < 0.001
      )
  )
  if (isDuplicate) {
    pendingSelection.value = null
    window.getSelection()?.removeAllRanges()
    return
  }

  const annotation: PaperAnnotation = {
    id: crypto.randomUUID(),
    type,
    color: type === 'highlight' ? '#facc15' : '#ef4444',
    page: pending.pageNumber,
    // 转成普通对象：Vue 的响应式代理无法通过 IPC 结构化克隆
    rects: pending.rects.map((rect) => ({ ...rect })),
    text: pending.text,
    createdAt: Date.now()
  }

  try {
    await window.api.addAnnotation(props.src, annotation)
    annotations.value.push(annotation)
    pendingSelection.value = null
    window.getSelection()?.removeAllRanges()
  } catch (err) {
    console.error('保存注释失败:', err)
  }
}

const removeSelectedAnnotations = async (): Promise<void> => {
  const pending = pendingSelection.value
  if (!pending || !window.api) return
  const targets = removableAnnotations.value
  if (targets.length === 0) return

  try {
    const removedIds = await window.api.removeAnnotations(
      props.src,
      targets.map((annotation) => annotation.id)
    )
    if (removedIds.length > 0) {
      const removed = new Set(removedIds)
      annotations.value = annotations.value.filter((annotation) => !removed.has(annotation.id))
      pendingSelection.value = null
      window.getSelection()?.removeAllRanges()
    }
  } catch (err) {
    console.error('取消标记失败:', err)
  }
}

// 在浏览器空闲时执行，避免与用户操作抢主线程
const whenIdle = (callback: () => void): void => {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => callback(), { timeout: 600 })
  } else {
    setTimeout(callback, 50)
  }
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined

const resizeObserver = new ResizeObserver(() => {
  const doc = pdfDoc
  if (!doc || loading.value) return
  // 面板开合过程中容器可能短暂为 0，忽略这次测量，避免把页面尺寸锁在最小宽度
  if (!containerRef.value?.clientWidth) return

  // 先用已知的页面比例更新 CSS 尺寸，本轮布局就能跟随容器变宽，避免延迟跳变
  availableWidth = computeAvailableWidth()
  for (const [pageNumber, canvas] of canvasRefs) {
    applyCanvasSize(pageNumber, canvas)
  }

  // 尺寸稳定后再重绘可视页；放在空闲时段并逐页串行渲染，减少卡顿
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    const currentGeneration = generation + 1
    generation = currentGeneration
    void cancelAllRenders()
    whenIdle(() => {
      const currentDoc = pdfDoc
      if (currentGeneration !== generation || !currentDoc) return
      renderVisiblePages(currentDoc, currentGeneration)
    })
  }, 300)
})

onMounted(() => {
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value)
  }
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('mouseup', handleMouseUp)
  document.addEventListener('dblclick', handleDoubleClick)
  void loadDocument()
  void loadAnnotations()
})

watch(
  () => props.src,
  () => {
    void loadDocument()
    void loadAnnotations()
  }
)

onBeforeUnmount(() => {
  generation += 1
  resizeObserver.disconnect()
  intersectionObserver?.disconnect()
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('mouseup', handleMouseUp)
  document.removeEventListener('dblclick', handleDoubleClick)
  if (resizeTimer) clearTimeout(resizeTimer)
  void cancelAllRenders()
  clearTextLayers()
  void pdfDoc?.loadingTask.destroy()
  pdfDoc = null
})
</script>

<style>
.pdf-text-layer {
  color-scheme: only light;
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 0;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}

.pdf-text-layer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  -webkit-user-select: text;
  user-select: text;
}

.pdf-text-layer > :not(.markedContent),
.pdf-text-layer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}

.pdf-text-layer .markedContent {
  display: contents;
}

.pdf-text-layer span[role='img'] {
  -webkit-user-select: none;
  user-select: none;
  cursor: default;
}

.pdf-text-layer ::selection {
  background: rgb(59 130 246 / 0.3);
}
</style>
