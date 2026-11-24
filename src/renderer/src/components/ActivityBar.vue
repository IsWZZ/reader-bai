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
            :aria-label="t(translationView.activityLabelKey)"
            :aria-pressed="$props.isTranslationOpen"
            :class="[
              'rounded-lg transition-colors',
              $props.isTranslationOpen ? 'bg-accent text-accent-foreground' : ''
            ]"
            @click="toggleTranslation"
          >
            <component :is="translationView.icon" class="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{{ t(translationView.titleKey) }}</TooltipContent>
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
import type { Component } from 'vue'
import { Button } from '@renderer/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider
} from '@renderer/components/ui/tooltip'
import { t, type MessageKey } from '@renderer/lib/i18n'
import { LibraryBig, Puzzle, Settings } from 'lucide-vue-next'
import type { PluginViewLocation } from '@renderer/types'

interface ActivityPluginView {
  key: string
  label: string
  location: PluginViewLocation
}

/** 外壳只需要模块视图的展示信息，不需要模块内部实现 */
interface ShellView {
  activityLabelKey: MessageKey
  titleKey: MessageKey
  icon: Component
}

withDefaults(
  defineProps<{
    isLibraryOpen: boolean
    isTranslationOpen: boolean
    translationView: ShellView
    settingsOpen?: boolean
    pluginViews?: ActivityPluginView[]
    activePluginViewKey?: string | null
  }>(),
  { settingsOpen: false, pluginViews: () => [], activePluginViewKey: null }
)

const emit = defineEmits<{
  toggleLibrary: []
  toggleTranslation: []
  openSettings: []
  togglePluginView: [key: string]
}>()

const toggleLibrary = (): void => {
  emit('toggleLibrary')
}

const toggleTranslation = (): void => {
  emit('toggleTranslation')
}
</script>
