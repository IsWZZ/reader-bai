import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Paper } from '@renderer/types'

/** 阅读区最多同时保留的论文数；超出后关闭最早打开的一篇 */
export const MAX_OPEN_PAPERS = 5

/**
 * 阅读区打开的论文标签。标签对应的 PdfViewer 会保持挂载，
 * 切换回来时滚动位置和缩放状态不变。
 */
export const useReadingStore = defineStore('reading', () => {
  const papers = ref<Paper[]>([])
  const activeId = ref<string | null>(null)

  const activePaper = computed(
    () => papers.value.find((paper) => paper.id === activeId.value) ?? null
  )

  const openPaper = (paper: Paper): void => {
    const index = papers.value.findIndex((item) => item.id === paper.id)
    if (index !== -1) {
      // 从书库再次点开时同步最新的标题和元数据
      papers.value[index] = paper
      activeId.value = paper.id
      return
    }

    papers.value.push(paper)
    activeId.value = paper.id
    while (papers.value.length > MAX_OPEN_PAPERS) {
      const oldest = papers.value.findIndex((item) => item.id !== activeId.value)
      if (oldest === -1) break
      papers.value.splice(oldest, 1)
    }
  }

  const activatePaper = (id: string): void => {
    if (papers.value.some((paper) => paper.id === id)) activeId.value = id
  }

  // 书目信息在侧栏更新后同步到已打开的论文，标签和右侧信息面板才能保持最新
  const syncPaper = (paper: Paper): void => {
    const index = papers.value.findIndex((item) => item.id === paper.id)
    if (index !== -1) papers.value[index] = paper
  }

  const closePaper = (id: string): void => {
    const index = papers.value.findIndex((paper) => paper.id === id)
    if (index === -1) return

    papers.value.splice(index, 1)
    if (activeId.value !== id) return
    // 关闭当前标签后优先切到原位置（右侧）的论文，否则回到左侧
    const next = papers.value[index] ?? papers.value[index - 1] ?? null
    activeId.value = next?.id ?? null
  }

  const reset = (): void => {
    papers.value = []
    activeId.value = null
  }

  return {
    papers,
    activeId,
    activePaper,
    openPaper,
    activatePaper,
    syncPaper,
    closePaper,
    reset
  }
})
