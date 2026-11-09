<template>
  <TooltipProvider>
    <div
      class="flex flex-col items-center w-12 shrink-0 bg-background border-r py-2 gap-2 overflow-y-auto"
    >
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :class="[
              'rounded-lg transition-colors',
              activeItem === 'library' ? 'bg-accent text-accent-foreground' : ''
            ]"
            @click="activeItem = 'library'"
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
              activeItem === 'settings' ? 'bg-accent text-accent-foreground' : ''
            ]"
            @click="activeItem = 'settings'"
          >
            <Settings class="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">设置</TooltipContent>
      </Tooltip>
    </div>
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
import { LibraryBig, Settings } from 'lucide-vue-next'

const activeItem = ref<'library' | 'settings'>('library')
</script>
