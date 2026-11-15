<template>
  <Tabs
    :model-value="activeId ?? ''"
    class="flex h-full min-h-0 flex-col"
    @update:model-value="onSelect"
  >
    <TabsList
      class="h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none border-b bg-muted/40 px-2 py-1.5"
      :aria-label="t('reading.tabs')"
    >
      <div
        v-for="paper in papers"
        :key="paper.id"
        class="flex shrink-0 items-center rounded-md transition-colors"
        :class="paper.id === activeId ? 'bg-background shadow-sm' : 'hover:bg-background/60'"
      >
        <TabsTrigger
          :value="paper.id"
          class="h-7 max-w-48 flex-none rounded-md border-0 px-2 text-xs data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <span class="truncate">{{ paper.title }}</span>
        </TabsTrigger>
        <Button
          variant="ghost"
          size="icon-xs"
          class="text-muted-foreground size-6 shrink-0"
          :aria-label="t('reading.closeTab', { title: paper.title })"
          @click="emit('close', paper.id)"
        >
          <X class="size-3" />
        </Button>
      </div>
    </TabsList>

    <!-- 论文面板由外壳提供，切换时保持挂载 -->
    <slot />
  </Tabs>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { Button } from '@renderer/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { t } from '@renderer/lib/i18n'
import type { Paper } from '@renderer/types'

defineProps<{
  papers: Paper[]
  activeId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  close: [id: string]
}>()

const onSelect = (value: unknown): void => {
  if (typeof value === 'string' && value) emit('select', value)
}
</script>
