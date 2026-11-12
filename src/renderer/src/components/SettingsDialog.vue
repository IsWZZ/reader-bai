<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent
      class="flex h-[520px] max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
    >
      <DialogHeader class="border-b px-5 py-4 pr-12">
        <DialogTitle>设置</DialogTitle>
        <DialogDescription>调整应用外观与 AI 服务</DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1">
        <nav class="w-40 shrink-0 border-r p-2">
          <button
            v-for="item in sections"
            :key="item.id"
            type="button"
            :class="[
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
              activeSection === item.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            ]"
            @click="activeSection = item.id"
          >
            <component :is="item.icon" class="size-4" />
            {{ item.label }}
          </button>
        </nav>

        <div class="min-w-0 flex-1 overflow-y-auto p-5">
          <section v-if="activeSection === 'appearance'" class="space-y-4">
            <div>
              <h3 class="text-sm font-medium">主题</h3>
              <p class="text-muted-foreground mt-1 text-xs">选择界面的明暗风格。</p>
            </div>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="option in themeOptions"
                :key="option.value"
                type="button"
                :class="[
                  'flex flex-col items-center gap-2 rounded-lg border p-4 text-xs transition-colors',
                  settingsStore.theme === option.value
                    ? 'border-primary bg-accent text-accent-foreground'
                    : 'hover:bg-accent/60'
                ]"
                @click="settingsStore.setTheme(option.value)"
              >
                <component :is="option.icon" class="size-5" />
                {{ option.label }}
              </button>
            </div>
            <p v-if="settingsStore.error" class="text-destructive text-xs">
              {{ settingsStore.error }}
            </p>
          </section>

          <section v-else class="space-y-4">
            <div>
              <h3 class="text-sm font-medium">AI 服务</h3>
              <p class="text-muted-foreground mt-1 text-xs">
                配置 OpenAI 兼容接口，供翻译、总结等功能读取调用。
              </p>
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-medium" for="ai-base-url">Base URL</label>
              <Input
                id="ai-base-url"
                v-model="baseUrl"
                placeholder="https://api.openai.com/v1"
                autocomplete="off"
                spellcheck="false"
                @input="status = 'idle'"
              />
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-medium" for="ai-api-key">API Key</label>
              <div class="relative">
                <Input
                  id="ai-api-key"
                  v-model="apiKey"
                  :type="showKey ? 'text' : 'password'"
                  class="pr-9"
                  placeholder="sk-..."
                  autocomplete="off"
                  spellcheck="false"
                  @input="status = 'idle'"
                />
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-9 items-center justify-center"
                  :aria-label="showKey ? '隐藏 API Key' : '显示 API Key'"
                  @click="showKey = !showKey"
                >
                  <EyeOff v-if="showKey" class="size-4" />
                  <Eye v-else class="size-4" />
                </button>
              </div>
              <p class="text-muted-foreground text-xs">
                API Key 保存在本机应用数据目录，系统支持时会加密存储。
              </p>
            </div>

            <div class="flex items-center gap-3">
              <Button type="button" size="sm" :disabled="settingsStore.saving" @click="saveAi">
                {{ settingsStore.saving ? '保存中…' : '保存' }}
              </Button>
              <span v-if="status === 'saved'" class="text-muted-foreground text-xs">已保存</span>
              <span v-else-if="formError" class="text-destructive text-xs">{{ formError }}</span>
            </div>
          </section>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AppTheme } from '@renderer/types'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { useSettingsStore } from '@renderer/store/settings'
import { Eye, EyeOff, Monitor, Moon, Palette, Sparkles, Sun } from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const settingsStore = useSettingsStore()

type SectionId = 'appearance' | 'ai'

const sections: { id: SectionId; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'ai', label: 'AI 服务', icon: Sparkles }
]

const themeOptions: { value: AppTheme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor }
]

const activeSection = ref<SectionId>('appearance')
const baseUrl = ref('')
const apiKey = ref('')
const showKey = ref(false)
const status = ref<'idle' | 'saved'>('idle')
const formError = ref('')

// 每次打开面板时同步一次存储中的值，避免显示旧数据
watch(
  () => props.open,
  (open) => {
    if (!open) return
    settingsStore.clearError()
    baseUrl.value = settingsStore.aiConfig.baseUrl
    apiKey.value = settingsStore.aiConfig.apiKey
    showKey.value = false
    status.value = 'idle'
    formError.value = ''
  }
)

const normalizeBaseUrl = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return trimmed.replace(/\/+$/, '')
  } catch {
    return null
  }
}

const saveAi = async (): Promise<void> => {
  formError.value = ''
  const normalized = normalizeBaseUrl(baseUrl.value)
  if (normalized === null) {
    formError.value = 'Base URL 需要是以 http:// 或 https:// 开头的地址'
    return
  }
  const saved = await settingsStore.saveAi({ baseUrl: normalized, apiKey: apiKey.value })
  if (saved) {
    baseUrl.value = settingsStore.aiConfig.baseUrl
    apiKey.value = settingsStore.aiConfig.apiKey
    status.value = 'saved'
  } else {
    formError.value = settingsStore.error || '保存失败'
  }
}
</script>
