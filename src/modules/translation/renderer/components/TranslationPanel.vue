<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      v-if="settingsStore.enabledAiProfiles.length > 0"
      class="flex items-center gap-2 border-b px-3 py-2"
    >
      <Select
        :model-value="settingsStore.activeAiProfile?.id ?? ''"
        :disabled="store.translation?.loading || settingsStore.saving"
        @update:model-value="handleProfileChange"
      >
        <SelectTrigger :aria-label="t('translation.selectModel')" size="sm" class="w-full">
          <SelectValue :placeholder="t('translation.selectModel')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="profile in settingsStore.enabledAiProfiles"
            :key="profile.id"
            :value="profile.id"
          >
            {{ profile.model || profile.baseUrl || t('common.untitledProfile') }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <p
      v-if="settingsStore.aiProfiles.length === 0"
      class="text-muted-foreground border-b px-3 py-2 text-xs leading-relaxed"
    >
      {{ t('translation.setupHint') }}
    </p>
    <p
      v-else-if="settingsStore.enabledAiProfiles.length === 0"
      class="text-muted-foreground border-b px-3 py-2 text-xs leading-relaxed"
    >
      {{ t('translation.noEnabledHint') }}
    </p>
    <p
      v-else-if="!store.isConfigured"
      class="text-muted-foreground border-b px-3 py-2 text-xs leading-relaxed"
    >
      {{ t('translation.incompleteHint') }}
    </p>
    <p
      v-if="store.activationError"
      class="text-destructive border-b px-3 py-2 text-xs leading-relaxed"
    >
      {{ store.activationError }}
    </p>

    <section class="min-h-0 flex-1 overflow-y-auto px-3 py-3" :aria-label="t('translation.result')">
      <div class="flex items-center justify-between">
        <h3 class="text-muted-foreground text-xs font-medium">{{ t('translation.result') }}</h3>
        <span v-if="store.translation?.loading" class="text-muted-foreground text-xs">
          {{ t('translation.translating') }}
        </span>
      </div>

      <p v-if="!store.translation" class="text-muted-foreground mt-2 text-xs leading-relaxed">
        {{ t('translation.selectionHint') }}
      </p>
      <template v-else>
        <p class="text-muted-foreground mt-2 line-clamp-2 text-xs">
          {{ store.translation.source }}
        </p>
        <p v-if="store.translation.error" class="text-destructive mt-2 text-xs leading-relaxed">
          {{ store.translation.error }}
        </p>
        <Skeleton
          v-else-if="store.translation.loading && !store.translation.text"
          class="mt-2 h-4 w-3/4"
        />
        <p v-else class="mt-2 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">
          {{ store.translation.text
          }}<span v-if="store.translation.loading" class="ml-0.5 animate-pulse">▍</span>
        </p>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { useSettingsStore } from '@renderer/store/settings'
import { t } from '@renderer/lib/i18n'
import { useTranslationStore } from '../store/translation'

const store = useTranslationStore()
const settingsStore = useSettingsStore()

const handleProfileChange = (value: unknown): void => {
  if (typeof value !== 'string' || !value || value === settingsStore.activeAiProfile?.id) return
  void settingsStore.setActiveAiProfile(value)
}

// 切换配置（包括从设置里删除当前配置）时清掉旧模型的译文
watch(
  () => settingsStore.activeAiProfile?.id,
  () => store.resetTranslation()
)
</script>
