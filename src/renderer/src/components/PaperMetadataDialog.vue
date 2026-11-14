<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[80vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{{ t('library.metadata.dialogTitle') }}</DialogTitle>
        <DialogDescription>
          {{ paper?.title ?? t('library.metadata.dialogDescription') }}
        </DialogDescription>
      </DialogHeader>

      <template v-if="metadata">
        <dl class="space-y-3 text-sm">
          <div v-if="metadata.authors.length">
            <dt class="text-muted-foreground text-xs">{{ t('library.metadata.authors') }}</dt>
            <dd class="mt-0.5">{{ metadata.authors.join(', ') }}</dd>
          </div>
          <div v-if="venueLine">
            <dt class="text-muted-foreground text-xs">{{ t('library.metadata.venue') }}</dt>
            <dd class="mt-0.5">{{ venueLine }}</dd>
          </div>
          <div v-if="metadata.doi">
            <dt class="text-muted-foreground text-xs">{{ t('library.metadata.doi') }}</dt>
            <dd class="mt-0.5 font-mono text-xs break-all">{{ metadata.doi }}</dd>
          </div>
          <div v-if="metadata.summary">
            <dt class="text-muted-foreground text-xs">{{ t('library.metadata.summary') }}</dt>
            <dd class="mt-0.5 leading-relaxed whitespace-pre-wrap">{{ metadata.summary }}</dd>
          </div>
          <div v-if="metadata.keywords.length">
            <dt class="text-muted-foreground text-xs">{{ t('library.metadata.keywords') }}</dt>
            <dd class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="keyword in metadata.keywords"
                :key="keyword"
                class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {{ keyword }}
              </span>
            </dd>
          </div>
          <div v-if="metadata.abstract">
            <dt class="text-muted-foreground text-xs">{{ t('library.metadata.abstract') }}</dt>
            <dd class="mt-0.5 max-h-56 overflow-y-auto leading-relaxed whitespace-pre-wrap">
              {{ metadata.abstract }}
            </dd>
          </div>
        </dl>

        <div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>{{ t('library.metadata.source') }}: {{ sourceLabel }}</span>
          <span>{{ t('library.metadata.analyzedAt') }}: {{ analyzedAt }}</span>
        </div>
      </template>

      <p v-else class="text-muted-foreground text-sm">{{ t('library.metadata.empty') }}</p>

      <div class="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="!paper || analyzing"
          @click="paper && emit('analyze', paper)"
        >
          <Loader2 v-if="analyzing" class="size-4 animate-spin" />
          <Sparkles v-else class="size-4" />
          {{ analyzing ? t('library.metadata.analyzing') : t('library.metadata.analyze') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, Sparkles } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { t } from '@renderer/lib/i18n'
import type { MessageKey } from '@renderer/lib/locales/types'
import type { Paper, PaperMetadataSource } from '@renderer/types'

const props = defineProps<{
  paper: Paper | null
  open: boolean
  analyzing?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  analyze: [paper: Paper]
}>()

const metadata = computed(() => props.paper?.metadata ?? null)

const venueLine = computed(() => {
  const current = metadata.value
  if (!current) return ''
  return [current.venue, current.year].filter(Boolean).join(' · ')
})

const sourceKeys: Record<PaperMetadataSource, MessageKey> = {
  ai: 'library.metadata.source.ai',
  crossref: 'library.metadata.source.crossref',
  mixed: 'library.metadata.source.mixed'
}

const sourceLabel = computed(() => (metadata.value ? t(sourceKeys[metadata.value.source]) : ''))

const analyzedAt = computed(() =>
  metadata.value ? new Date(metadata.value.analyzedAt).toLocaleString() : ''
)
</script>
