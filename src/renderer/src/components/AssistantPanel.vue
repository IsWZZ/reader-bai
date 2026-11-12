<template>
  <aside
    aria-label="辅助面板"
    class="bg-card flex h-full shrink-0 flex-col overflow-hidden rounded-lg border"
    :style="{ width: width + 'px' }"
  >
    <header class="flex items-center justify-between border-b px-3 py-2">
      <div class="flex items-center gap-2">
        <Sparkles class="text-muted-foreground size-4" />
        <h2 class="text-sm font-medium">翻译与 AI</h2>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="关闭辅助面板" @click="emit('close')">
        <X class="size-4" />
      </Button>
    </header>

    <div
      v-if="settingsStore.aiProfiles.length > 0"
      class="flex items-center gap-2 border-b px-3 py-2"
    >
      <select
        aria-label="选择模型"
        class="border-input focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
        :value="settingsStore.activeAiProfile?.id ?? ''"
        :disabled="store.chatLoading || settingsStore.saving"
        @change="handleProfileChange"
      >
        <option v-for="profile in settingsStore.aiProfiles" :key="profile.id" :value="profile.id">
          {{ aiProfileLabel(profile) }}
        </option>
      </select>
    </div>

    <p
      v-if="settingsStore.aiProfiles.length === 0"
      class="text-muted-foreground border-b px-3 py-2 text-xs leading-relaxed"
    >
      请先在设置 → AI 服务中添加并补全配置。
    </p>
    <p
      v-else-if="!store.isConfigured"
      class="text-muted-foreground border-b px-3 py-2 text-xs leading-relaxed"
    >
      所选 AI 服务的 Base URL、API Key 或模型不完整，请到设置中补全。
    </p>

    <section class="shrink-0 border-b px-3 py-2" aria-label="译文">
      <div class="flex items-center justify-between">
        <h3 class="text-muted-foreground text-xs font-medium">译文</h3>
        <span v-if="translation?.loading" class="text-muted-foreground text-xs">翻译中…</span>
      </div>

      <p v-if="!translation" class="text-muted-foreground mt-2 text-xs leading-relaxed">
        在阅读区选中文本即可自动查看译文。
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
        也可以直接向 AI 提问，回答会流式显示在这里。
      </p>
      <div
        v-for="entry in store.messages"
        :key="entry.id"
        :class="entry.role === 'user' ? 'flex justify-end' : 'flex justify-start'"
      >
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
      <p v-if="store.chatError" class="text-destructive text-xs leading-relaxed">
        {{ store.chatError }}
      </p>
    </div>

    <div class="border-t p-2">
      <div class="flex items-end gap-2">
        <textarea
          v-model="draft"
          aria-label="向 AI 提问"
          rows="2"
          placeholder="向 AI 提问，Enter 发送，Shift+Enter 换行"
          class="border-input placeholder:text-muted-foreground focus-visible:ring-ring/50 max-h-32 min-h-9 flex-1 resize-none rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-2"
          @keydown="handleKeydown"
        />
        <Button v-if="store.chatLoading" size="icon-sm" aria-label="停止" @click="store.stopChat()">
          <Square class="size-4" />
        </Button>
        <Button v-else size="icon-sm" aria-label="发送" :disabled="!draft.trim()" @click="submit">
          <Send class="size-4" />
        </Button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@renderer/components/ui/button'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { useAssistantStore, type ChatEntry } from '@renderer/store/assistant'
import { useSettingsStore } from '@renderer/store/settings'
import { aiProfileLabel } from '@renderer/lib/ai'
import { Send, Sparkles, Square, X } from 'lucide-vue-next'

defineProps<{ width: number }>()

const emit = defineEmits<{ close: [] }>()

const store = useAssistantStore()
const settingsStore = useSettingsStore()
const draft = ref('')
const listRef = ref<HTMLDivElement | null>(null)

const translation = computed(() => store.translation)

const handleProfileChange = (event: Event): void => {
  const id = (event.target as HTMLSelectElement).value
  if (!id || id === settingsStore.activeAiProfile?.id) return
  void settingsStore.setActiveAiProfile(id)
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
