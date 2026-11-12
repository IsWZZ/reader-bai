<template>
  <TooltipProvider>
    <div
      class="flex flex-col items-center w-12 shrink-0 bg-background border rounded-lg py-2 gap-2 overflow-y-auto"
    >
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :class="[
              'rounded-lg transition-colors',
              $props.isLibraryOpen ? 'bg-accent text-accent-foreground' : ''
            ]"
            @click="toggleLibrary"
          >
            <LibraryBig class="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">论文库</TooltipContent>
      </Tooltip>

      <div class="flex-1" />

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :class="[
              'rounded-lg transition-colors',
              settingsOpen ? 'bg-accent text-accent-foreground' : ''
            ]"
            @click="settingsOpen = true"
          >
            <Settings class="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">设置</TooltipContent>
      </Tooltip>
    </div>

    <SettingsDialog v-model:open="settingsOpen" />
  </TooltipProvider>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@renderer/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from '@renderer/components/ui/tooltip'
import SettingsDialog from '@renderer/components/SettingsDialog.vue'
import { LibraryBig, Settings } from 'lucide-vue-next'

defineProps<{
  isLibraryOpen: boolean
}>()

const settingsOpen = ref(false)

const emit = defineEmits<{
  toggleLibrary: []
}>()

const toggleLibrary = (): void => {
  emit('toggleLibrary')
}
</script>
