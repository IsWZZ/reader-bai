<template>
  <aside
    :aria-label="label"
    class="bg-card flex h-full shrink-0 flex-col overflow-hidden rounded-lg border"
    :style="{ width: width + 'px', maxWidth }"
  >
    <header class="flex items-center justify-between gap-2 border-b px-3 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <component :is="icon" v-if="icon" class="text-muted-foreground size-4 shrink-0" />
        <h2 class="truncate text-sm font-medium">{{ title }}</h2>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <slot name="actions" />
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="closeLabel ?? t('common.close')"
          @click="emit('close')"
        >
          <X class="size-4" />
        </Button>
      </div>
    </header>

    <!-- 右侧栏是开放的容器：AI 辅助、论文信息以及后续插件视图都挂在同一个窗口里 -->
    <div class="flex min-h-0 flex-1 flex-col">
      <slot />
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { X } from 'lucide-vue-next'
import { Button } from '@renderer/components/ui/button'
import { t } from '@renderer/lib/i18n'

defineProps<{
  width: number
  /** 窗口变窄时限制右侧栏宽度，给阅读区留出空间 */
  maxWidth?: string
  /** aside 的无障碍名称，视图之间可以不同 */
  label: string
  title: string
  icon?: Component
  closeLabel?: string
}>()

const emit = defineEmits<{ close: [] }>()
</script>
