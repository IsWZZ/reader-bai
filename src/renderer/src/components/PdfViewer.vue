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
            <Button variant="ghost" size="icon-sm" @click="resetZoom">
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

const handleMouseUp = (event: MouseEvent): void => {
  // 点击工具栏按钮时保留之前捕获的选区，否则按钮的 mouseup 会把选区清空
  if (event.target instanceof Element && event.target.closest('button')) return
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
  document.addEventListener('mouseup', handleMouseUp)
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
  document.removeEventListener('mouseup', handleMouseUp)
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
