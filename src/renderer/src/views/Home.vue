<template>
  <div class="flex flex-col h-screen bg-background overflow-hidden p-2 gap-1">
    <Toolbar v-model:search-query="searchQuery" />
    <div class="flex flex-1 overflow-hidden gap-0.5">
      <ActivityBar
        :is-library-open="isLibraryOpen"
        :is-assistant-open="isAssistantOpen"
        @toggle-library="toggleLibrary"
        @toggle-assistant="toggleAssistant"
      />
      <LibraryPanel
        v-if="isLibraryOpen"
        v-model:width="libraryWidth"
        :current-paper-id="currentPaper?.id"
        :search-query="searchQuery"
        @select-paper="handleSelectPaper"
      />
      <!-- 拖拽分隔符 -->
      <div
        v-if="isLibraryOpen"
        class="w-0.5 cursor-col-resize hover:bg-primary/50 transition-colors rounded-full"
        @mousedown="startResize"
      />
      <main class="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card p-4">
        <div v-if="currentPaper" class="h-full">
          <PdfViewer
            v-if="currentPaper.path"
            :src="currentPaper.path"
            class="h-full"
            @selection-change="handleSelection"
          />
        </div>
        <div v-else class="flex items-center justify-center h-full">
          <p class="text-muted-foreground">{{ t('home.empty') }}</p>
        </div>
      </main>

      <template v-if="isAssistantOpen">
        <!-- 拖拽分隔符 -->
        <div
          class="w-0.5 cursor-col-resize hover:bg-primary/50 transition-colors rounded-full"
          @mousedown="startAssistantResize"
        />
        <AssistantPanel :width="assistantWidth" @close="isAssistantOpen = false" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import Toolbar from '@renderer/components/Toolbar.vue'
import ActivityBar from '@renderer/components/ActivityBar.vue'
import LibraryPanel from '@renderer/components/LibraryPanel.vue'
import PdfViewer from '@renderer/components/PdfViewer.vue'
import AssistantPanel from '@renderer/components/AssistantPanel.vue'
import { useAssistantStore } from '@renderer/store/assistant'
import { t } from '@renderer/lib/i18n'
import type { Paper } from '@renderer/types'

const isLibraryOpen = ref(true)
const libraryWidth = ref(256)
const minWidth = 200
const maxWidth = 500
const currentPaper = ref<Paper | null>(null)
// 顶部搜索框控制书库面板的过滤
const searchQuery = ref('')

const assistantStore = useAssistantStore()
const isAssistantOpen = ref(false)
const assistantWidth = ref(340)
const minAssistantWidth = 280
const maxAssistantWidth = 560

onMounted(() => {
  assistantStore.initialize()
})

// 面板关闭时只记录选区；打开后再翻译最近一次选区
watch(isAssistantOpen, (open) => assistantStore.setAutoTranslate(open), { immediate: true })

// 检索时确保书库可见，否则结果无处展示
watch(searchQuery, (query) => {
  if (query.trim()) isLibraryOpen.value = true
})

// 切换论文时清空译文，聊天记录保留
watch(
  () => currentPaper.value?.id,
  () => assistantStore.resetTranslation()
)

const toggleLibrary = (): void => {
  isLibraryOpen.value = !isLibraryOpen.value
}

const toggleAssistant = (): void => {
  isAssistantOpen.value = !isAssistantOpen.value
}

const handleSelectPaper = (paper: Paper): void => {
  currentPaper.value = paper
}

const handleSelection = (payload: { text: string; page: number }): void => {
  assistantStore.handleSelection(payload.text)
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

// 右侧面板向左拖才变宽，所以取反 delta
const startAssistantResize = (e: MouseEvent): void => {
  const startX = e.clientX
  const startWidth = assistantWidth.value

  const onMouseMove = (moveEvent: MouseEvent): void => {
    const deltaX = moveEvent.clientX - startX
    const newWidth = Math.min(Math.max(startWidth - deltaX, minAssistantWidth), maxAssistantWidth)
    assistantWidth.value = newWidth
  }

  const onMouseUp = (): void => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}
</script>
