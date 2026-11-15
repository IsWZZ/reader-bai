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
            :aria-label="t('activity.library')"
            :aria-pressed="$props.isLibraryOpen"
            :class="[
              'rounded-lg transition-colors',
              $props.isLibraryOpen ? 'bg-accent text-accent-foreground' : ''
            ]"
            @click="toggleLibrary"
          >
            <LibraryBig class="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{{ t('activity.library') }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('activity.assistant')"
            :aria-pressed="$props.isAssistantOpen"
            :class="[
              'rounded-lg transition-colors',
              $props.isAssistantOpen ? 'bg-accent text-accent-foreground' : ''
            ]"
            @click="toggleAssistant"
          >
            <Sparkles class="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{{ t('assistant.title') }}</TooltipContent>
      </Tooltip>

      <Tooltip v-for="view in pluginViews" :key="view.key">
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="view.label"
            :aria-pressed="view.key === activePluginViewKey"
            :class="[
              'rounded-lg transition-colors',
              view.key === activePluginViewKey ? 'bg-accent text-accent-foreground' : ''
            ]"
            @click="emit('togglePluginView', view.key)"
          >
            <Puzzle class="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{{ view.label }}</TooltipContent>
      </Tooltip>

      <div class="flex-1" />

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('activity.settings')"
            :aria-pressed="$props.settingsOpen"
            :class="[
              'rounded-lg transition-colors',
              $props.settingsOpen ? 'bg-accent text-accent-foreground' : ''
            ]"
            @click="emit('openSettings')"
          >
            <Settings class="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{{ t('activity.settings') }}</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { Button } from '@renderer/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from '@renderer/components/ui/tooltip'
import { t } from '@renderer/lib/i18n'
import { LibraryBig, Puzzle, Settings, Sparkles } from 'lucide-vue-next'
import type { PluginViewLocation } from '@renderer/types'

interface ActivityPluginView {
  key: string
  label: string
  location: PluginViewLocation
}

withDefaults(
  defineProps<{
    isLibraryOpen: boolean
    isAssistantOpen: boolean
    settingsOpen?: boolean
    pluginViews?: ActivityPluginView[]
    activePluginViewKey?: string | null
  }>(),
  { settingsOpen: false, pluginViews: () => [], activePluginViewKey: null }
)

const emit = defineEmits<{
  toggleLibrary: []
  toggleAssistant: []
  openSettings: []
  togglePluginView: [key: string]
}>()

const toggleLibrary = (): void => {
  emit('toggleLibrary')
}

const toggleAssistant = (): void => {
  emit('toggleAssistant')
}
</script>
