<template>
  <div class="flex flex-col h-screen bg-background overflow-hidden p-2 gap-1">
    <Toolbar v-model:search-query="searchQuery" />
    <div class="flex flex-1 overflow-hidden gap-0.5">
      <ActivityBar
        :is-library-open="isLibraryOpen"
        :is-translation-open="isTranslationOpen"
        :translation-view="translationView"
        :settings-open="settingsOpen"
        :plugin-views="activityPluginViews"
        :active-plugin-view-key="activePluginViewKey"
        @toggle-library="toggleLibrary"
        @toggle-translation="toggleTranslation"
        @open-settings="openSettingsAt('basic')"
        @toggle-plugin-view="togglePluginView"
      />
      <div
        v-if="isLibraryOpen && activeSidebarView"
        class="h-full shrink-0"
        :style="{ width: libraryWidth + 'px' }"
      >
        <PluginViewFrame
          :plugin-id="activeSidebarView.pluginId"
          :plugin-name="activeSidebarView.pluginName"
          :view="activeSidebarView"
          @close="closePluginView(activeSidebarView.key)"
        />
      </div>
      <LibraryPanel
        v-else-if="isLibraryOpen"
        ref="libraryPanelRef"
        v-model:width="libraryWidth"
        :expanded="!hasReadingArea"
        :current-paper-id="currentPaper?.id"
        :search-query="searchQuery"
        @select-paper="handleSelectPaper"
        @update-paper="readingStore.syncPaper"
        @show-paper-info="showPaperInfo"
        @request-ai-settings="openAiSettings"
      />
      <!-- 拖拽分隔符 -->
      <div
        v-if="isLibraryOpen && hasReadingArea"
        class="w-0.5 cursor-col-resize hover:bg-primary/50 transition-colors rounded-full"
        @mousedown="startResize"
      />
      <!-- 没有打开的论文或 main 插件视图时，论文库撑满主区域 -->
      <main v-if="hasReadingArea" class="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card">
        <div v-if="activeMainView" class="h-full p-4">
          <PluginViewFrame
            :plugin-id="activeMainView.pluginId"
            :plugin-name="activeMainView.pluginName"
            :view="activeMainView"
            @close="closePluginView(activeMainView.key)"
          />
        </div>
        <PaperTabs
          v-else-if="readingStore.papers.length > 0"
          :papers="readingStore.papers"
          :active-id="readingStore.activeId"
          @select="readingStore.activatePaper"
          @close="readingStore.closePaper"
        >
          <!-- force-mount 让每篇论文的阅读器保持挂载，切回时保留滚动位置和缩放；
               force-mount 不会自动隐藏非当前面板，需要用 data-state 显式隐藏 -->
          <TabsContent
            v-for="paper in readingStore.papers"
            :key="paper.id"
            :value="paper.id"
            force-mount
            class="min-h-0 px-4 pt-2 pb-4 data-[state=inactive]:hidden"
          >
            <PdfViewer :src="paper.path" class="h-full" @selection-change="handleSelection" />
          </TabsContent>
        </PaperTabs>
      </main>

      <!-- 右侧栏是开放的窗口：翻译、论文信息（以及后续插件视图）共用这个容器 -->
      <template v-if="rightView">
        <!-- 拖拽分隔符 -->
        <div
          class="w-0.5 cursor-col-resize hover:bg-primary/50 transition-colors rounded-full"
          @mousedown="startTranslationResize"
        />
        <RightSidebar
          :width="translationWidth"
          :max-width="rightSidebarMaxWidth"
          :label="rightViewLabel"
          :title="rightViewTitle"
          :icon="rightViewIcon"
          :close-label="rightViewCloseLabel"
          @close="rightView = null"
        >
          <template #actions>
            <Button
              v-if="rightView === 'paper-info' && currentPaper"
              variant="ghost"
              size="icon-sm"
              :aria-label="t('common.edit')"
              @click="editPaperMetadata(currentPaper)"
            >
              <Pencil class="size-4" />
            </Button>
          </template>

          <component :is="translationView.component" v-if="rightView === translationView.id" />
          <PaperInfoPanel v-else :paper="currentPaper" />
        </RightSidebar>
      </template>
    </div>

    <SettingsDialog v-model:open="settingsOpen" :initial-section="settingsSection" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Toolbar from '@renderer/components/Toolbar.vue'
import ActivityBar from '@renderer/components/ActivityBar.vue'
import LibraryPanel from '@renderer/components/LibraryPanel.vue'
import PdfViewer from '@renderer/components/PdfViewer.vue'
import PaperInfoPanel from '@renderer/components/PaperInfoPanel.vue'
import PaperTabs from '@renderer/components/PaperTabs.vue'
import RightSidebar from '@renderer/components/RightSidebar.vue'
import PluginViewFrame from '@renderer/components/PluginViewFrame.vue'
import SettingsDialog from '@renderer/components/SettingsDialog.vue'
import { TabsContent } from '@renderer/components/ui/tabs'
import { translationView, useTranslationStore } from '@modules/translation/renderer'
import { usePluginsStore } from '@renderer/store/plugins'
import { useReadingStore } from '@renderer/store/reading'
import { useSettingsStore } from '@renderer/store/settings'
import { t } from '@renderer/lib/i18n'
import { Button } from '@renderer/components/ui/button'
import { FileText, Pencil } from 'lucide-vue-next'
import type { Paper, PluginViewInfo, PluginViewLocation } from '@renderer/types'

const isLibraryOpen = ref(true)
const libraryWidth = ref(256)
const minWidth = 200
const maxWidth = 500
const readingStore = useReadingStore()
const currentPaper = computed(() => readingStore.activePaper)
// 顶部搜索框控制书库面板的过滤
const searchQuery = ref('')

const translationStore = useTranslationStore()
const settingsStore = useSettingsStore()
const pluginsStore = usePluginsStore()
// 右侧栏同一时间只展示一个视图；后续插件视图也可以接入这个窗口
type RightView = typeof translationView.id | 'paper-info'
const rightView = ref<RightView | null>(null)
const isTranslationOpen = computed(() => rightView.value === translationView.id)
const libraryPanelRef = ref<InstanceType<typeof LibraryPanel> | null>(null)
type SettingsSection = 'basic' | 'ai' | 'library' | 'plugins' | 'uninstall'
const settingsOpen = ref(false)
const settingsSection = ref<SettingsSection>('basic')
const translationWidth = ref(340)
const minTranslationWidth = 280
const maxTranslationWidth = 560

interface ActivePluginView extends PluginViewInfo {
  key: string
  pluginId: string
  pluginName: string
}

interface ActivityPluginView {
  key: string
  label: string
  location: PluginViewLocation
}

const pluginViews = computed<ActivePluginView[]>(() =>
  pluginsStore.plugins
    .filter((plugin) => plugin.enabled && plugin.compatible)
    .flatMap((plugin) =>
      plugin.views.map((view) => ({
        ...view,
        key: `${plugin.id}/${view.id}`,
        pluginId: plugin.id,
        pluginName: plugin.name
      }))
    )
)

const activityPluginViews = computed<ActivityPluginView[]>(() =>
  pluginViews.value.map((view) => ({
    key: view.key,
    label: `${view.pluginName} · ${view.title}`,
    location: view.location
  }))
)

const activePluginViewKey = ref<string | null>(null)
const activePluginView = computed(
  () => pluginViews.value.find((view) => view.key === activePluginViewKey.value) ?? null
)
const activeSidebarView = computed(() =>
  activePluginView.value?.location === 'sidebar' ? activePluginView.value : null
)
const activeMainView = computed(() =>
  activePluginView.value?.location === 'main' ? activePluginView.value : null
)
// 阅读区（论文标签或 main 插件视图）打开时才有独立的主区域
const hasReadingArea = computed(
  () => activeMainView.value !== null || readingStore.papers.length > 0
)

// 右侧窗口的标题、无障碍名称和图标跟随当前视图；翻译视图由模块描述提供
const rightViewLabel = computed(() =>
  rightView.value === translationView.id ? t(translationView.panelLabelKey) : t('paperInfo.title')
)
const rightViewTitle = computed(() =>
  rightView.value === translationView.id ? t(translationView.titleKey) : t('paperInfo.title')
)
const rightViewCloseLabel = computed(() =>
  rightView.value === translationView.id ? t(translationView.closeLabelKey) : t('common.close')
)
const rightViewIcon = computed(() =>
  rightView.value === translationView.id ? translationView.icon : FileText
)

// 阅读区优先：右侧栏最多占剩余空间的一半再少一点，避免窗口较窄时
// 信息面板比 PDF 正文还宽。宽度由 CSS max-width 响应式限制。
const rightSidebarMaxWidth = computed(() => {
  const activityBar = 48
  const gaps = 8
  const readingPriority = 48
  const reserved =
    activityBar + (isLibraryOpen.value ? libraryWidth.value : 0) + gaps + readingPriority
  return `calc((100% - ${reserved}px) / 2)`
})

const closePluginView = (key: string): void => {
  if (activePluginViewKey.value === key) activePluginViewKey.value = null
}

const togglePluginView = (key: string): void => {
  const view = pluginViews.value.find((item) => item.key === key)
  if (!view) return
  if (activePluginViewKey.value === key) {
    activePluginViewKey.value = null
    return
  }
  activePluginViewKey.value = key
  if (view.location === 'sidebar') isLibraryOpen.value = true
}

onMounted(() => {
  translationStore.initialize()
  void pluginsStore.load()
})

// 面板关闭时只记录选区；打开后再翻译最近一次选区
watch(isTranslationOpen, (open) => translationStore.setAutoTranslate(open), { immediate: true })

// 检索时确保书库可见，否则结果无处展示
watch(searchQuery, (query) => {
  if (query.trim()) isLibraryOpen.value = true
})

// 切换论文时清空译文
watch(
  () => currentPaper.value?.id,
  () => translationStore.resetTranslation()
)

const toggleLibrary = (): void => {
  // 侧栏插件视图占用同一个位置；点击论文库时先退回书库
  if (activePluginView.value?.location === 'sidebar') {
    activePluginViewKey.value = null
    isLibraryOpen.value = true
    return
  }
  isLibraryOpen.value = !isLibraryOpen.value
}

const openSettingsAt = (section: SettingsSection): void => {
  settingsSection.value = section
  settingsOpen.value = true
}

const openAiSettings = (): void => openSettingsAt('ai')

const toggleTranslation = (): void => {
  if (isTranslationOpen.value) {
    rightView.value = null
    return
  }
  // 点击活动栏即启动翻译进程；即使随后因为未配置跳转到设置，进程也保持常驻
  void translationStore.activate().catch(() => undefined)
  // 没有可用的 AI 配置时，先把用户带到设置页，而不是打开一个无法工作的面板
  if (!settingsStore.isAiConfigured) {
    openAiSettings()
    return
  }
  rightView.value = translationView.id
}

const handleSelectPaper = (paper: Paper): void => {
  readingStore.openPaper(paper)
  // 阅读时默认在右侧展示论文信息；翻译面板已经占用右侧时不抢位置
  if (rightView.value !== translationView.id) rightView.value = 'paper-info'
}

// 论文库的「论文信息」：打开论文并唤起右侧信息面板
const showPaperInfo = (paper: Paper): void => {
  readingStore.openPaper(paper)
  rightView.value = 'paper-info'
}

const editPaperMetadata = (paper: Paper): void => {
  // 复用论文库里的详情弹窗（编辑模式）
  libraryPanelRef.value?.openMetadata?.(paper, true)
}

const handleSelection = (payload: { text: string; page: number }): void => {
  translationStore.handleSelection(payload.text)
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
const startTranslationResize = (e: MouseEvent): void => {
  const startX = e.clientX
  const startWidth = translationWidth.value

  const onMouseMove = (moveEvent: MouseEvent): void => {
    const deltaX = moveEvent.clientX - startX
    const newWidth = Math.min(
      Math.max(startWidth - deltaX, minTranslationWidth),
      maxTranslationWidth
    )
    translationWidth.value = newWidth
  }

  const onMouseUp = (): void => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}
</script>
