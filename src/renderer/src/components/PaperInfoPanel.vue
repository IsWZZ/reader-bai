<template>
  <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
    <template v-if="paper">
      <h3 class="text-sm leading-snug font-medium break-words">{{ paper.title }}</h3>
      <p class="text-muted-foreground mt-1 text-xs break-all">{{ paper.fileName }}</p>

      <div v-if="paper.metadata" class="mt-3">
        <PaperMetadataView :metadata="paper.metadata" />
      </div>
      <p v-else class="text-muted-foreground mt-3 text-xs leading-relaxed">
        {{ t('paperInfo.noMetadata') }}
      </p>
    </template>
    <p v-else class="text-muted-foreground text-xs leading-relaxed">
      {{ t('paperInfo.empty') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import PaperMetadataView from '@renderer/components/PaperMetadataView.vue'
import { t } from '@renderer/lib/i18n'
import type { Paper } from '@renderer/types'

defineProps<{ paper: Paper | null }>()
</script>
