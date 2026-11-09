<template>
  <div ref="containerRef" class="relative h-full w-full overflow-y-auto bg-muted/30 rounded-lg">
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
    <div v-else class="flex flex-col items-center gap-4 p-4">
      <canvas
        v-for="pageNumber in pageCount"
        :key="pageNumber"
        :ref="(el) => setCanvasRef(pageNumber, el as HTMLCanvasElement | null)"
        :data-page="pageNumber"
        class="bg-white shadow-md"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

// 用内联 worker，避免打包后 file:// 协议下按 URL 加载 worker 失败
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker()

const props = defineProps<{
  /** 论文在磁盘上的绝对路径 */
  src: string
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const pageCount = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)

let pdfDoc: PDFDocumentProxy | null = null
// 每次切换文档或重新布局时递增，过期任务据此丢弃
let generation = 0
// 页面渲染宽度（容器内宽减去左右 padding）
let availableWidth = 0

const canvasRefs = new Map<number, HTMLCanvasElement>()
// 每页在 scale=1 时的尺寸，用于占位高度和缩放计算
const pageSizes = new Map<number, { width: number; height: number }>()
// 每页最近一次渲染时的宽度，宽度没变就不重复渲染
const renderedWidths = new Map<number, number>()
const pageTasks = new Map<number, RenderTask>()
// 所有页面共用一条渲染队列，避免多页同时绘制抢占主线程
let renderQueue: Promise<void> = Promise.resolve()

let intersectionObserver: IntersectionObserver | null = null

const setCanvasRef = (pageNumber: number, el: HTMLCanvasElement | null): void => {
  if (el) {
    canvasRefs.set(pageNumber, el)
  } else {
    canvasRefs.delete(pageNumber)
  }
}

const computeAvailableWidth = (): number =>
  Math.max((containerRef.value?.clientWidth ?? 0) - 32, 200)

// 用已知的页面比例更新 canvas 的占位尺寸（不涉及像素渲染，成本很低）
const applyCanvasSize = (pageNumber: number, canvas: HTMLCanvasElement): void => {
  const size = pageSizes.get(pageNumber)
  if (!size || !availableWidth) return
  canvas.style.width = `${availableWidth}px`
  canvas.style.height = `${Math.max(1, Math.round((size.height / size.width) * availableWidth))}px`
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

const renderPage = async (
  doc: PDFDocumentProxy,
  pageNumber: number,
  currentGeneration: number
): Promise<void> => {
  if (currentGeneration !== generation) return

  const canvas = canvasRefs.get(pageNumber)
  if (!canvas || !availableWidth) return
  if (renderedWidths.get(pageNumber) === availableWidth) return

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
  if (renderedWidths.get(pageNumber) === availableWidth) return

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

  const width = availableWidth
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
        const pageNumber = Number((entry.target as HTMLElement).dataset.page)
        if (pageNumber > 0) {
          scheduleRender(doc, pageNumber, currentGeneration)
        }
      }
    },
    { root: containerRef.value, rootMargin: '200px 0px' }
  )
  for (const canvas of canvasRefs.values()) {
    intersectionObserver.observe(canvas)
  }
}

const loadDocument = async (): Promise<void> => {
  generation += 1
  const currentGeneration = generation

  loading.value = true
  error.value = null
  pageCount.value = 0
  pageSizes.clear()
  renderedWidths.clear()
  canvasRefs.clear()

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
  void loadDocument()
})

watch(
  () => props.src,
  () => {
    void loadDocument()
  }
)

onBeforeUnmount(() => {
  generation += 1
  resizeObserver.disconnect()
  intersectionObserver?.disconnect()
  if (resizeTimer) clearTimeout(resizeTimer)
  void cancelAllRenders()
  void pdfDoc?.loadingTask.destroy()
  pdfDoc = null
})
</script>
