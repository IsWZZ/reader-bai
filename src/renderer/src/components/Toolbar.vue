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
    <div class="flex-1 max-w-md no-drag">
      <Input v-model="searchQuery" :placeholder="t('toolbar.search')" class="w-full" />
    </div>
    <!-- <div class="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm">
        <Settings class="size-4" />
      </Button>
    </div> -->
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { t } from '@renderer/lib/i18n'
import { Home, BookOpen } from 'lucide-vue-next'

const searchQuery = ref('')
</script>

<style scoped>
.draggable {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}
</style>
