<template>
  <div class="flex flex-col h-screen bg-background overflow-hidden p-2 gap-1">
    <Toolbar />
    <div class="flex flex-1 overflow-hidden gap-0.5">
      <ActivityBar :is-library-open="isLibraryOpen" @toggle-library="toggleLibrary" />
      <LibraryPanel
        v-if="isLibraryOpen"
        v-model:width="libraryWidth"
        @select-paper="handleSelectPaper"
      />
      <!-- 拖拽分隔符 -->
      <div
        v-if="isLibraryOpen"
        class="w-0.5 cursor-col-resize hover:bg-primary/50 transition-colors rounded-full"
        @mousedown="startResize"
      />
      <main class="flex-1 overflow-hidden rounded-lg border bg-card p-4">
        <div v-if="currentPaper" class="h-full">
          <PdfViewer v-if="currentPaper.path" :src="currentPaper.path" class="h-full" />
        </div>
        <div v-else class="flex items-center justify-center h-full">
          <p class="text-muted-foreground">选择论文开始阅读</p>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Toolbar from '@renderer/components/Toolbar.vue'
import ActivityBar from '@renderer/components/ActivityBar.vue'
import LibraryPanel from '@renderer/components/LibraryPanel.vue'
import PdfViewer from '@renderer/components/PdfViewer.vue'

interface Paper {
  id: string
  title: string
  path?: string
}

const isLibraryOpen = ref(true)
const libraryWidth = ref(256)
const minWidth = 200
const maxWidth = 500
const currentPaper = ref<Paper | null>(null)

const toggleLibrary = (): void => {
  isLibraryOpen.value = !isLibraryOpen.value
}

const handleSelectPaper = (paper: Paper): void => {
  currentPaper.value = paper
}

const startResize = (e: MouseEvent): void => {
  const startX = e.clientX
  const startWidth = libraryWidth.value

  const onMouseMove = (moveEvent: MouseEvent): void => {
    const deltaX = moveEvent.clientX - startX
    const newWidth = Math.min(Math.max(startWidth + deltaX, minWidth), maxWidth)
    libraryWidth.value = newWidth
  }

  const onMouseUp = (): void => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}
</script>
