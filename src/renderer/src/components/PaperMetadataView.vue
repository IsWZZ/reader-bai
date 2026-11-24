<template>
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
        <Badge v-for="keyword in metadata.keywords" :key="keyword" variant="secondary">
          {{ keyword }}
        </Badge>
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

<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@renderer/components/ui/badge'
import { t } from '@renderer/lib/i18n'
import type { MessageKey } from '@renderer/lib/locales/types'
import type { PaperMetadata, PaperMetadataSource } from '@renderer/types'

const props = defineProps<{ metadata: PaperMetadata }>()

const venueLine = computed(() =>
  [props.metadata.venue, props.metadata.year].filter(Boolean).join(' · ')
)

const sourceKeys: Record<PaperMetadataSource, MessageKey> = {
  ai: 'library.metadata.source.ai',
  crossref: 'library.metadata.source.crossref',
  mixed: 'library.metadata.source.mixed',
  manual: 'library.metadata.source.manual'
}

const sourceLabel = computed(() => t(sourceKeys[props.metadata.source]))
const analyzedAt = computed(() => new Date(props.metadata.analyzedAt).toLocaleString())
</script>
