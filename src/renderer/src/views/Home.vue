<template>
  <div class="flex flex-col h-screen bg-background overflow-hidden p-2 gap-1">
    <Toolbar />
    <div class="flex flex-1 overflow-hidden gap-0.5">
      <ActivityBar />
      <LibraryPanel v-model:width="libraryWidth" />
      <!-- 拖拽分隔符 -->
      <div
        class="w-0.5 cursor-col-resize hover:bg-primary/50 transition-colors rounded-full"
        @mousedown="startResize"
      />
      <main class="flex-1 overflow-y-auto rounded-lg border bg-card p-4">
        <p class="text-muted-foreground">阅读区</p>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Toolbar from '@renderer/components/Toolbar.vue'
import ActivityBar from '@renderer/components/ActivityBar.vue'
import LibraryPanel from '@renderer/components/LibraryPanel.vue'

const libraryWidth = ref(256)
const minWidth = 200
const maxWidth = 500

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
