<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[80vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{{ t('library.metadata.dialogTitle') }}</DialogTitle>
        <DialogDescription>
          {{ paper?.title ?? t('library.metadata.dialogDescription') }}
        </DialogDescription>
      </DialogHeader>

      <form
        v-if="editing && paper"
        id="paper-metadata-form"
        class="space-y-3 text-sm"
        @submit.prevent="submit"
      >
        <div>
          <Label for="metadata-title" class="text-muted-foreground text-xs font-normal">
            {{ t('library.metadata.title') }}
          </Label>
          <Input id="metadata-title" v-model="form.title" class="mt-1" />
        </div>
        <div>
          <Label for="metadata-authors" class="text-muted-foreground text-xs font-normal">
            {{ t('library.metadata.authors') }}
          </Label>
          <Textarea
            id="metadata-authors"
            v-model="form.authors"
            class="mt-1"
            :placeholder="t('library.metadata.authorsHint')"
            rows="3"
          />
        </div>
        <div>
          <Label for="metadata-venue" class="text-muted-foreground text-xs font-normal">
            {{ t('library.metadata.venue') }}
          </Label>
          <Input id="metadata-venue" v-model="form.venue" class="mt-1" />
        </div>
        <div>
          <Label for="metadata-venue-type" class="text-muted-foreground text-xs font-normal">
            {{ t('library.metadata.venueType') }}
          </Label>
          <Select v-model="form.venueType">
            <SelectTrigger id="metadata-venue-type" class="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{{ t('library.metadata.venueType.none') }}</SelectItem>
              <SelectItem v-for="type in venueTypes" :key="type.value" :value="type.value">
                {{ t(type.label) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label for="metadata-year" class="text-muted-foreground text-xs font-normal">
            {{ t('library.metadata.year') }}
          </Label>
          <Input id="metadata-year" v-model="form.year" type="number" min="1800" class="mt-1" />
        </div>
        <div>
          <Label for="metadata-doi" class="text-muted-foreground text-xs font-normal">
            {{ t('library.metadata.doi') }}
          </Label>
          <Input id="metadata-doi" v-model="form.doi" class="mt-1 font-mono" />
        </div>
        <div>
          <Label for="metadata-keywords" class="text-muted-foreground text-xs font-normal">
            {{ t('library.metadata.keywords') }}
          </Label>
          <Input
            id="metadata-keywords"
            v-model="form.keywords"
            class="mt-1"
            :placeholder="t('library.metadata.keywordsHint')"
          />
        </div>
        <div>
          <Label for="metadata-abstract" class="text-muted-foreground text-xs font-normal">
            {{ t('library.metadata.abstract') }}
          </Label>
          <Textarea id="metadata-abstract" v-model="form.abstract" class="mt-1" rows="4" />
        </div>
        <div>
          <Label for="metadata-summary" class="text-muted-foreground text-xs font-normal">
            {{ t('library.metadata.summary') }}
          </Label>
          <Textarea id="metadata-summary" v-model="form.summary" class="mt-1" rows="3" />
        </div>
        <p v-if="saveError" class="text-destructive text-xs">{{ saveError }}</p>
      </form>

      <template v-else-if="metadata">
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

      <p v-else class="text-muted-foreground text-sm">{{ t('library.metadata.empty') }}</p>

      <div class="flex justify-end gap-2">
        <template v-if="editing">
          <Button type="button" variant="outline" size="sm" @click="cancelEdit">
            {{ t('common.cancel') }}
          </Button>
          <Button type="submit" form="paper-metadata-form" size="sm" :disabled="saving">
            <Loader2 v-if="saving" class="size-4 animate-spin" />
            {{ saving ? t('common.saving') : t('common.save') }}
          </Button>
        </template>
        <template v-else>
          <Button type="button" variant="outline" size="sm" :disabled="!paper" @click="startEdit">
            <Pencil class="size-4" />
            {{ t('common.edit') }}
          </Button>
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
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { Loader2, Pencil, Sparkles } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { t } from '@renderer/lib/i18n'
import type { MessageKey } from '@renderer/lib/locales/types'
import type {
  Paper,
  PaperMetadataInput,
  PaperMetadataSource,
  PaperVenueType
} from '@renderer/types'

const props = defineProps<{
  paper: Paper | null
  open: boolean
  editing?: boolean
  analyzing?: boolean
  saving?: boolean
  saveError?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:editing': [value: boolean]
  analyze: [paper: Paper]
  save: [paper: Paper, metadata: PaperMetadataInput]
}>()

const metadata = computed(() => props.paper?.metadata ?? null)

interface MetadataForm {
  title: string
  authors: string
  venue: string
  venueType: PaperVenueType | 'none'
  year: string | number
  doi: string
  abstract: string
  keywords: string
  summary: string
}

const form = reactive<MetadataForm>({
  title: '',
  authors: '',
  venue: '',
  venueType: 'none',
  year: '',
  doi: '',
  abstract: '',
  keywords: '',
  summary: ''
})

const resetForm = (): void => {
  const current = metadata.value
  form.title = current?.title ?? ''
  form.authors = current ? current.authors.join('\n') : ''
  form.venue = current?.venue ?? ''
  form.venueType = current?.venueType ?? 'none'
  form.year = current?.year ? String(current.year) : ''
  form.doi = current?.doi ?? ''
  form.abstract = current?.abstract ?? ''
  form.keywords = current ? current.keywords.join(', ') : ''
  form.summary = current?.summary ?? ''
}

watch(
  () => props.open,
  (open) => {
    if (open) resetForm()
  },
  { immediate: true }
)

watch(
  () => props.editing,
  (editing) => {
    if (editing) resetForm()
  }
)

watch(
  () => props.paper?.id,
  () => {
    resetForm()
  }
)

const startEdit = (): void => {
  resetForm()
  emit('update:editing', true)
}

const cancelEdit = (): void => {
  resetForm()
  emit('update:editing', false)
}

const submit = (): void => {
  if (!props.paper || props.saving) return
  emit('save', props.paper, {
    title: form.title.trim() || undefined,
    authors: form.authors
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean),
    venue: form.venue.trim() || undefined,
    venueType: form.venueType === 'none' ? undefined : form.venueType,
    year: form.year === '' ? undefined : String(form.year),
    doi: form.doi.trim() || undefined,
    abstract: form.abstract.trim() || undefined,
    keywords: form.keywords
      .split(/[,，]/)
      .map((keyword) => keyword.trim())
      .filter(Boolean),
    summary: form.summary.trim() || undefined
  })
}

const venueTypes: { value: PaperVenueType; label: MessageKey }[] = [
  { value: 'journal', label: 'library.metadata.venueType.journal' },
  { value: 'conference', label: 'library.metadata.venueType.conference' },
  { value: 'preprint', label: 'library.metadata.venueType.preprint' },
  { value: 'book', label: 'library.metadata.venueType.book' },
  { value: 'other', label: 'library.metadata.venueType.other' }
]

const venueLine = computed(() => {
  const current = metadata.value
  if (!current) return ''
  return [current.venue, current.year].filter(Boolean).join(' · ')
})

const sourceKeys: Record<PaperMetadataSource, MessageKey> = {
  ai: 'library.metadata.source.ai',
  crossref: 'library.metadata.source.crossref',
  mixed: 'library.metadata.source.mixed',
  manual: 'library.metadata.source.manual'
}

const sourceLabel = computed(() => (metadata.value ? t(sourceKeys[metadata.value.source]) : ''))

const analyzedAt = computed(() =>
  metadata.value ? new Date(metadata.value.analyzedAt).toLocaleString() : ''
)
</script>
