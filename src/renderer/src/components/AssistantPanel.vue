<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      v-if="settingsStore.enabledAiProfiles.length > 0"
      class="flex items-center gap-2 border-b px-3 py-2"
    >
      <Select
        :model-value="settingsStore.activeAiProfile?.id ?? ''"
        :disabled="store.chatLoading || settingsStore.saving"
        @update:model-value="handleProfileChange"
      >
        <SelectTrigger :aria-label="t('assistant.selectModel')" size="sm" class="w-full">
          <SelectValue :placeholder="t('assistant.selectModel')" />
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
      <Label
        for="assistant-use-tools"
        class="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs leading-normal font-normal whitespace-nowrap"
        :title="t('assistant.toolsTitle')"
      >
        <Checkbox
          id="assistant-use-tools"
          :aria-label="t('assistant.useTools')"
          :model-value="store.agentMode"
          :disabled="store.chatLoading"
          @update:model-value="(value) => handleAgentModeChange(value === true)"
        />
        {{ t('assistant.tools') }}
      </Label>
    </div>

    <p
      v-if="settingsStore.aiProfiles.length === 0"
      class="text-muted-foreground border-b px-3 py-2 text-xs leading-relaxed"
    >
      {{ t('assistant.setupHint') }}
    </p>
    <p
      v-else-if="settingsStore.enabledAiProfiles.length === 0"
      class="text-muted-foreground border-b px-3 py-2 text-xs leading-relaxed"
    >
      {{ t('assistant.noEnabledHint') }}
    </p>
    <p
      v-else-if="!store.isConfigured"
      class="text-muted-foreground border-b px-3 py-2 text-xs leading-relaxed"
    >
      {{ t('assistant.incompleteHint') }}
    </p>

    <section class="shrink-0 border-b px-3 py-2" :aria-label="t('assistant.translation')">
      <div class="flex items-center justify-between">
        <h3 class="text-muted-foreground text-xs font-medium">{{ t('assistant.translation') }}</h3>
        <span v-if="translation?.loading" class="text-muted-foreground text-xs">
          {{ t('assistant.translating') }}
        </span>
      </div>

      <p v-if="!translation" class="text-muted-foreground mt-2 text-xs leading-relaxed">
        {{ t('assistant.selectionHint') }}
      </p>
      <template v-else>
        <p class="text-muted-foreground mt-2 line-clamp-2 text-xs">{{ translation.source }}</p>
        <p v-if="translation.error" class="text-destructive mt-2 text-xs leading-relaxed">
          {{ translation.error }}
        </p>
        <Skeleton v-else-if="translation.loading && !translation.text" class="mt-2 h-4 w-3/4" />
        <p
          v-else
          class="mt-2 max-h-40 overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap"
        >
          {{ translation.text
          }}<span v-if="translation.loading" class="ml-0.5 animate-pulse">▍</span>
        </p>
      </template>
    </section>

    <div
      ref="listRef"
      class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
      aria-live="polite"
    >
      <p v-if="store.messages.length === 0" class="text-muted-foreground text-xs leading-relaxed">
        {{ t('assistant.chatHint') }}
      </p>
      <div v-for="entry in store.messages" :key="entry.id" class="space-y-1">
        <div :class="entry.role === 'user' ? 'flex justify-end' : 'flex justify-start'">
          <p
            :class="[
              'max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap',
              entry.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground'
            ]"
          >
            {{ entry.content
            }}<span v-if="isStreamingEntry(entry)" class="ml-0.5 animate-pulse" aria-hidden="true"
              >▍</span
            >
          </p>
        </div>
        <ul
          v-if="entry.toolNotes?.length"
          class="space-y-0.5 pl-1"
          :aria-label="t('assistant.toolLog')"
        >
          <li
            v-for="(note, index) in entry.toolNotes"
            :key="index"
            class="text-muted-foreground text-xs leading-relaxed"
          >
            {{ note }}
          </li>
        </ul>
      </div>
      <p v-if="store.chatError" class="text-destructive text-xs leading-relaxed">
        {{ store.chatError }}
      </p>
    </div>

    <div class="border-t p-2">
      <div class="flex items-end gap-2">
        <Textarea
          v-model="draft"
          :aria-label="t('assistant.ask')"
          rows="2"
          :placeholder="t('assistant.placeholder')"
          class="max-h-32 min-h-9 flex-1 resize-none px-2 py-1.5 text-sm"
          @keydown="handleKeydown"
        />
        <Button
          v-if="store.chatLoading"
          size="icon-sm"
          :aria-label="t('assistant.stop')"
          @click="store.stopChat()"
        >
          <Square class="size-4" />
        </Button>
        <Button
          v-else
          size="icon-sm"
          :aria-label="t('assistant.send')"
          :disabled="!draft.trim()"
          @click="submit"
        >
          <Send class="size-4" />
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Textarea } from '@renderer/components/ui/textarea'
import { useAssistantStore, type ChatEntry } from '@renderer/store/assistant'
import { useSettingsStore } from '@renderer/store/settings'
import { t } from '@renderer/lib/i18n'
import { Send, Square } from 'lucide-vue-next'

const store = useAssistantStore()
const settingsStore = useSettingsStore()
const draft = ref('')
const listRef = ref<HTMLDivElement | null>(null)

const translation = computed(() => store.translation)

const handleProfileChange = (value: unknown): void => {
  if (typeof value !== 'string' || !value || value === settingsStore.activeAiProfile?.id) return
  void settingsStore.setActiveAiProfile(value)
}

const handleAgentModeChange = (enabled: boolean): void => {
  store.agentMode = enabled
}

// 切换配置（包括从设置里删除当前配置）时清掉旧模型的译文
watch(
  () => settingsStore.activeAiProfile?.id,
  () => store.resetTranslation()
)

const isStreamingEntry = (entry: ChatEntry): boolean =>
  store.chatLoading &&
  entry.role === 'assistant' &&
  store.messages[store.messages.length - 1]?.id === entry.id

const submit = (): void => {
  const content = draft.value
  if (!content.trim()) return
  draft.value = ''
  void store.sendChat(content)
}

const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}

// 流式输出时保持滚动到底部
const scrollSignature = computed(() => {
  const last = store.messages[store.messages.length - 1]
  return `${store.messages.length}:${last ? last.content.length : 0}`
})

watch(scrollSignature, async () => {
  await nextTick()
  const element = listRef.value
  if (element) element.scrollTop = element.scrollHeight
})
</script>
