<template>
  <div ref="rootRef" class="flex rounded-lg border" :style="{ width: width + 'px' }">
    <SidebarProvider :default-open="true">
      <Sidebar collapsible="none" class="w-full h-full">
        <SidebarContent>
          <!-- 头部标题 -->
          <SidebarHeader class="border-b px-4 py-1">
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {{ t('library.title') }}
              </h2>
              <div class="flex items-center">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="rounded-lg"
                      :aria-label="t('library.newSpace')"
                      @click="startCreateSpace"
                    >
                      <FolderPlus class="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{{ t('library.newSpace') }}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="rounded-lg"
                      :aria-label="t('library.importPaper')"
                      @click="importPaper()"
                    >
                      <Plus class="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{{ t('library.importPaper') }}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </SidebarHeader>

          <div class="flex-1 overflow-y-auto">
            <!-- 新建空间 -->
            <div v-if="creatingSpace" class="flex items-center gap-2 px-3 py-1.5">
              <FolderPlus class="size-4 shrink-0 text-muted-foreground" />
              <Input
                v-model="newSpaceName"
                data-inline-input
                class="h-7 px-2 text-sm"
                :placeholder="t('library.spaceNamePlaceholder')"
                @keydown.enter="onInlineEnter($event, confirmCreateSpace)"
                @keydown.esc="onInlineEscape($event, cancelCreateSpace)"
                @blur="confirmCreateSpace"
              />
            </div>

            <!-- 空状态 -->
            <div
              v-if="loaded && !hasAnyItem && !creatingSpace"
              class="flex flex-col items-center justify-center h-full text-center p-6"
            >
              <LibraryBig class="size-12 text-muted-foreground/40 mb-3" />
              <p class="text-sm text-muted-foreground">{{ t('library.empty') }}</p>
              <p class="text-xs text-muted-foreground/70 mt-1">{{ t('library.emptyHint') }}</p>
            </div>

            <!-- 检索无结果 -->
            <div
              v-else-if="loaded && searching && !hasSearchResults"
              class="flex flex-col items-center justify-center h-full text-center p-6"
            >
              <SearchX class="size-12 text-muted-foreground/40 mb-3" />
              <p class="text-sm text-muted-foreground">
                {{ t('library.search.empty', { query: searchTerm }) }}
              </p>
              <p class="text-xs text-muted-foreground/70 mt-1">
                {{ t('library.search.emptyHint') }}
              </p>
            </div>

            <!-- 空间与论文 -->
            <SidebarGroup
              v-for="group in groups"
              :key="group.key"
              class="py-1 rounded-md transition-colors"
              :class="dragOverGroupKey === group.key ? 'bg-accent/50 ring-1 ring-primary/30' : ''"
              @dragover="onGroupDragOver($event, group)"
              @dragleave="onGroupDragLeave($event, group)"
              @drop="onGroupDrop($event, group)"
            >
              <!-- 空间标题行 -->
              <div
                class="group/space flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60"
              >
                <template v-if="group.space && renamingSpaceId === group.space.id">
                  <Folder class="size-3.5 shrink-0" />
                  <Input
                    v-model="spaceNameDraft"
                    data-inline-input
                    class="h-6 min-w-0 flex-1 px-1.5 text-xs"
                    @keydown.enter="onInlineEnter($event, confirmRenameSpace)"
                    @keydown.esc="onInlineEscape($event, cancelRenameSpace)"
                    @blur="confirmRenameSpace"
                  />
                </template>
                <template v-else>
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    @click="toggleGroup(group.key)"
                  >
                    <ChevronDown
                      class="size-3.5 shrink-0 transition-transform"
                      :class="isCollapsed(group.key) ? '-rotate-90' : ''"
                    />
                    <Folder class="size-3.5 shrink-0" />
                    <span class="truncate">{{ group.name }}</span>
                    <span class="ml-auto shrink-0 pr-1 text-[10px] tabular-nums opacity-60">
                      {{ group.papers.length }}
                    </span>
                  </button>
                  <!-- 导入论文到该空间 -->
                  <Tooltip v-if="group.space">
                    <TooltipTrigger as-child>
                      <button
                        type="button"
                        class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                        :aria-label="t('library.importTo', { name: group.name })"
                        @click.stop="importPaper(group.space.id)"
                      >
                        <FilePlus class="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{{ t('library.import') }}</TooltipContent>
                  </Tooltip>
                  <DropdownMenu v-if="group.space">
                    <DropdownMenuTrigger as-child>
                      <button
                        type="button"
                        class="flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-sidebar-accent focus-visible:opacity-100 group-hover/space:opacity-100 data-[state=open]:opacity-100"
                        :aria-label="t('library.spaceActions', { name: group.name })"
                        @click.stop
                      >
                        <MoreHorizontal class="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start">
                      <DropdownMenuItem @select="startRenameSpace(group.space)">
                        <Pencil class="size-4" />
                        {{ t('library.renameSpace') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        class="text-destructive focus:text-destructive"
                        @select="deleteSpace(group.space)"
                      >
                        <Trash2 class="size-4" />
                        {{ t('library.deleteSpace') }}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </template>
              </div>

              <!-- 空间内的论文 -->
              <SidebarGroupContent v-show="!isCollapsed(group.key)">
                <SidebarMenu>
                  <SidebarMenuItem v-for="paper in group.papers" :key="paper.id">
                    <div
                      v-if="renamingPaperId === paper.id"
                      class="flex h-8 items-center gap-2 px-2"
                    >
                      <FileText class="size-4 shrink-0" />
                      <Input
                        v-model="paperTitleDraft"
                        data-inline-input
                        class="h-6 min-w-0 flex-1 px-1.5 text-sm"
                        @keydown.enter="onInlineEnter($event, confirmRenamePaper)"
                        @keydown.esc="onInlineEscape($event, cancelRenamePaper)"
                        @blur="confirmRenamePaper"
                      />
                    </div>
                    <template v-else>
                      <SidebarMenuButton
                        :is-active="paper.id === currentPaperId"
                        draggable="true"
                        :class="draggingPaperId === paper.id ? 'opacity-50' : ''"
                        @click="selectPaper(paper)"
                        @dblclick="startRenamePaper(paper)"
                        @dragstart="onPaperDragStart($event, paper)"
                        @dragend="onDragEnd"
                      >
                        <FileText class="size-4" />
                        <span class="truncate">{{ paper.title }}</span>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger as-child>
                          <SidebarMenuAction
                            show-on-hover
                            :aria-label="t('library.paperActions', { title: paper.title })"
                            @click.stop
                            @mousedown.stop
                            @dblclick.stop
                          >
                            <MoreHorizontal />
                          </SidebarMenuAction>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start">
                          <DropdownMenuItem @select="startRenamePaper(paper)">
                            <Pencil class="size-4" />
                            {{ t('library.rename') }}
                          </DropdownMenuItem>
                          <DropdownMenuLabel>{{ t('library.moveToSpace') }}</DropdownMenuLabel>
                          <DropdownMenuItem
                            v-for="target in moveTargets"
                            :key="target.id ?? 'unassigned'"
                            :disabled="paper.spaceId === target.id"
                            @select="movePaper(paper, target.id)"
                          >
                            <Folder class="size-4" />
                            {{ target.name }}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            class="text-destructive focus:text-destructive"
                            @select="removePaper(paper)"
                          >
                            <Trash2 class="size-4" />
                            {{ t('library.remove') }}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </template>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from '@renderer/components/ui/sidebar'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@renderer/components/ui/tooltip'
import {
  ChevronDown,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  LibraryBig,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchX,
  Trash2
} from 'lucide-vue-next'
import { t } from '@renderer/lib/i18n'
import { filterPapers } from '@renderer/lib/library-search'
import { readPdfTitle } from '@renderer/lib/pdf'
import type { LibraryData, Paper, Space } from '@renderer/types'

const emit = defineEmits<{
  selectPaper: [paper: Paper]
}>()

interface PaperGroup {
  key: string
  space: Space | null
  name: string
  papers: Paper[]
}

const rootRef = ref<HTMLDivElement | null>(null)
const loaded = ref(false)
const spaces = ref<Space[]>([])
const papers = ref<Paper[]>([])
// 折叠的空间（按分组 key 记录）
const collapsedGroups = ref(new Set<string>())
// 检索词来自顶部搜索栏；这里只过滤已加载的标题/文件名，不请求主进程
const props = defineProps<{
  width: number
  currentPaperId?: string | null
  searchQuery?: string
}>()
const searchTerm = computed(() => (props.searchQuery ?? '').trim())
const searching = computed(() => searchTerm.value.length > 0)
const visiblePapers = computed(() => filterPapers(papers.value, props.searchQuery ?? ''))
const hasSearchResults = computed(() => visiblePapers.value.length > 0)

// 新建/重命名空间的临时输入状态
const creatingSpace = ref(false)
const newSpaceName = ref('')
const renamingSpaceId = ref<string | null>(null)
const spaceNameDraft = ref('')

// 重命名论文的临时输入状态
const renamingPaperId = ref<string | null>(null)
const paperTitleDraft = ref('')

const hasAnyItem = computed(() => spaces.value.length > 0 || papers.value.length > 0)

const groups = computed<PaperGroup[]>(() => {
  const result: PaperGroup[] = spaces.value.map((space) => ({
    key: space.id,
    space,
    name: space.name,
    papers: visiblePapers.value.filter((paper) => paper.spaceId === space.id)
  }))
  const unassigned = visiblePapers.value.filter(
    (paper) => !paper.spaceId || !spaces.value.some((space) => space.id === paper.spaceId)
  )
  if (unassigned.length > 0) {
    result.push({
      key: 'unassigned',
      space: null,
      name: t('common.uncategorized'),
      papers: unassigned
    })
  }
  // 检索时只保留有命中的空间，避免整列空分组
  return searching.value ? result.filter((group) => group.papers.length > 0) : result
})

const moveTargets = computed<{ id: string | null; name: string }[]>(() => [
  { id: null, name: t('common.uncategorized') },
  ...spaces.value.map((space) => ({ id: space.id, name: space.name }))
])

const applyState = (state: LibraryData): void => {
  spaces.value = state.spaces
  papers.value = state.papers
}

// 检索时强制展开，否则命中结果可能被折叠的空间挡住
const isCollapsed = (key: string): boolean => !searching.value && collapsedGroups.value.has(key)

const toggleGroup = (key: string): void => {
  const next = new Set(collapsedGroups.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  collapsedGroups.value = next
}

// 聚焦当前展开的行内输入框（新建空间 / 重命名）
const focusInlineInput = async (): Promise<void> => {
  await nextTick()
  rootRef.value?.querySelector<HTMLInputElement>('[data-inline-input]')?.select()
}

// 输入法组词中按 Enter/Esc 只用于确认或取消候选词，
// 此时 v-model 还没收到组词内容，直接提交会拿到空值并关掉输入框
const isComposingEvent = (event: KeyboardEvent): boolean =>
  event.isComposing || event.keyCode === 229

const onInlineEnter = (event: KeyboardEvent, commit: () => unknown): void => {
  if (isComposingEvent(event)) return
  event.preventDefault()
  void commit()
}

const onInlineEscape = (event: KeyboardEvent, cancel: () => void): void => {
  if (isComposingEvent(event)) return
  event.stopPropagation()
  cancel()
}

// 读取 PDF 元数据里的标题，并更新“仍在使用文件名”的论文
const autoTitlePaper = async (paper: Paper): Promise<void> => {
  if (!window.api || paper.titleSource !== 'file') return
  try {
    const data = await window.api.readPaper(paper.path)
    const title = await readPdfTitle(data)
    if (!title || title === paper.title) return
    applyState(await window.api.renamePaper(paper.id, title, 'metadata'))
  } catch (error) {
    console.warn(`解析论文标题失败: ${paper.path}`, error)
  }
}

// 启动时补齐旧论文库中仍以文件名命名的标题
const backfillTitles = async (): Promise<void> => {
  const pending = papers.value.filter((paper) => paper.titleSource === 'file')
  for (const paper of pending) {
    await autoTitlePaper(paper)
  }
}

onMounted(async () => {
  if (!window.api) {
    console.error('window.api is not available')
    loaded.value = true
    return
  }
  try {
    applyState(await window.api.listPapers())
  } catch (error) {
    console.error('加载论文库失败:', error)
  } finally {
    loaded.value = true
  }
  void backfillTitles()
})

// 导入论文
const importPaper = async (spaceId: string | null = null): Promise<void> => {
  if (!window.api) {
    console.error('window.api is not available')
    return
  }
  try {
    const paper = await window.api.importPaper(spaceId)
    if (!paper) return
    // 重复导入同一篇论文时主进程会返回已有记录（可能已被移动到目标空间），这里同步更新
    const index = papers.value.findIndex((item) => item.id === paper.id)
    if (index === -1) {
      papers.value.push(paper)
    } else {
      papers.value[index] = paper
    }
    // 默认名称先取文件名，随后用 PDF 里解析出的标题替换
    void autoTitlePaper(paper)
  } catch (error) {
    console.error('导入论文失败:', error)
  }
}

// 选择论文
const selectPaper = (paper: Paper): void => {
  emit('selectPaper', paper)
}

// ---------- 空间管理 ----------

const startCreateSpace = (): void => {
  creatingSpace.value = true
  newSpaceName.value = ''
  void focusInlineInput()
}

const confirmCreateSpace = async (): Promise<void> => {
  if (!creatingSpace.value) return
  const name = newSpaceName.value.trim()
  creatingSpace.value = false
  newSpaceName.value = ''
  if (!name || !window.api) return
  try {
    applyState(await window.api.createSpace(name))
  } catch (error) {
    console.error('新建空间失败:', error)
  }
}

const cancelCreateSpace = (): void => {
  creatingSpace.value = false
  newSpaceName.value = ''
}

const startRenameSpace = (space: Space): void => {
  renamingSpaceId.value = space.id
  spaceNameDraft.value = space.name
  void focusInlineInput()
}

const confirmRenameSpace = async (): Promise<void> => {
  const id = renamingSpaceId.value
  if (!id) return
  const name = spaceNameDraft.value.trim()
  const current = spaces.value.find((space) => space.id === id)
  renamingSpaceId.value = null
  spaceNameDraft.value = ''
  if (!name || !current || name === current.name || !window.api) return
  try {
    applyState(await window.api.renameSpace(id, name))
  } catch (error) {
    console.error('重命名空间失败:', error)
  }
}

const cancelRenameSpace = (): void => {
  renamingSpaceId.value = null
  spaceNameDraft.value = ''
}

const deleteSpace = async (space: Space): Promise<void> => {
  if (!window.api) return
  try {
    // 空间里的论文会退回“未分类”，不会删除论文本身
    applyState(await window.api.deleteSpace(space.id))
  } catch (error) {
    console.error('删除空间失败:', error)
  }
}

// ---------- 论文管理 ----------

const startRenamePaper = (paper: Paper): void => {
  renamingPaperId.value = paper.id
  paperTitleDraft.value = paper.title
  void focusInlineInput()
}

const confirmRenamePaper = async (): Promise<void> => {
  const id = renamingPaperId.value
  if (!id) return
  const title = paperTitleDraft.value.trim()
  const current = papers.value.find((paper) => paper.id === id)
  renamingPaperId.value = null
  paperTitleDraft.value = ''
  if (!title || !current || title === current.title || !window.api) return
  try {
    applyState(await window.api.renamePaper(id, title, 'user'))
  } catch (error) {
    console.error('重命名论文失败:', error)
  }
}

const cancelRenamePaper = (): void => {
  renamingPaperId.value = null
  paperTitleDraft.value = ''
}

const movePaper = async (paper: Paper, spaceId: string | null): Promise<void> => {
  if (!window.api || paper.spaceId === spaceId) return
  try {
    applyState(await window.api.movePaper(paper.id, spaceId))
  } catch (error) {
    console.error('移动论文失败:', error)
  }
}

// ---------- 拖拽移动论文 ----------

const draggingPaperId = ref<string | null>(null)
// 当前拖拽悬停的分组，用于高亮可放置区域
const dragOverGroupKey = ref<string | null>(null)

const draggingPaper = computed(
  () => papers.value.find((paper) => paper.id === draggingPaperId.value) ?? null
)

const onPaperDragStart = (event: DragEvent, paper: Paper): void => {
  if (!event.dataTransfer) return
  draggingPaperId.value = paper.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', paper.id)
}

const onDragEnd = (): void => {
  draggingPaperId.value = null
  dragOverGroupKey.value = null
}

const groupSpaceId = (group: PaperGroup): string | null => group.space?.id ?? null

const onGroupDragOver = (event: DragEvent, group: PaperGroup): void => {
  const paper = draggingPaper.value
  if (!paper) return
  // 论文已经在目标分组里，不显示可放置状态
  if (paper.spaceId === groupSpaceId(group)) {
    dragOverGroupKey.value = null
    return
  }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverGroupKey.value = group.key
}

const onGroupDragLeave = (event: DragEvent, group: PaperGroup): void => {
  if (dragOverGroupKey.value !== group.key) return
  // 在分组内部的元素之间移动时不取消高亮
  const related = event.relatedTarget as Node | null
  if (related && (event.currentTarget as HTMLElement).contains(related)) return
  dragOverGroupKey.value = null
}

const onGroupDrop = async (event: DragEvent, group: PaperGroup): Promise<void> => {
  event.preventDefault()
  const id = event.dataTransfer?.getData('text/plain') || draggingPaperId.value
  dragOverGroupKey.value = null
  draggingPaperId.value = null
  if (!id) return
  const paper = papers.value.find((item) => item.id === id)
  if (!paper) return
  await movePaper(paper, groupSpaceId(group))
}

const removePaper = async (paper: Paper): Promise<void> => {
  if (!window.api) return
  try {
    applyState(await window.api.removePaper(paper.id))
  } catch (error) {
    console.error('移除论文失败:', error)
  }
}
</script>
