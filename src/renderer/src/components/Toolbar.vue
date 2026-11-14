<template>
  <div class="flex items-center justify-center gap-2 px-4 py-1 bg-background border-b draggable">
    <div class="flex items-center gap-1 no-drag">
      <Button variant="ghost" size="icon-sm" :aria-label="t('toolbar.home')">
        <Home class="size-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" :aria-label="t('toolbar.reading')">
        <BookOpen class="size-4" />
      </Button>
    </div>
    <div class="relative flex-1 max-w-md no-drag">
      <Search
        class="pointer-events-none absolute inset-y-0 left-2 my-auto size-3.5 text-muted-foreground"
      />
      <Input
        v-model="query"
        class="w-full pl-7 pr-7"
        :placeholder="t('toolbar.search')"
        :aria-label="t('toolbar.searchLabel')"
        @keydown.esc.stop="clear"
      />
      <button
        v-if="query"
        type="button"
        class="absolute inset-y-0 right-1 my-auto flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
        :aria-label="t('toolbar.clearSearch')"
        @click="clear"
      >
        <X class="size-3.5" />
      </button>
    </div>
    <!-- <div class="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm">
        <Settings class="size-4" />
      </Button>
    </div> -->
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { t } from '@renderer/lib/i18n'
import { Home, BookOpen, Search, X } from 'lucide-vue-next'

// 顶部搜索只负责输入，实际过滤由书库面板完成
const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ 'update:searchQuery': [value: string] }>()

const query = computed({
  get: () => props.searchQuery ?? '',
  set: (value: string) => emit('update:searchQuery', value)
})

const clear = (): void => {
  emit('update:searchQuery', '')
}
</script>

<style scoped>
.draggable {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}
</style>
