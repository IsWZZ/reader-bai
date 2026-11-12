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
                保存多份 OpenAI 兼容接口配置，在右侧辅助面板的下拉中选择使用哪一个。
              </p>
            </div>

            <p v-if="profiles.length === 0" class="text-muted-foreground text-xs">
              还没有配置，点击「新增模型」开始。
            </p>
            <ul v-else class="divide-y rounded-md border">
              <li
                v-for="profile in profiles"
                :key="profile.id"
                class="flex items-center gap-2 px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm">{{ aiProfileLabel(profile) }}</p>
                  <p class="text-muted-foreground truncate text-xs">
                    {{ profile.baseUrl || '未填写 Base URL' }}
                  </p>
                </div>
                <span
                  v-if="profile.id === settingsStore.activeAiProfile?.id"
                  class="bg-accent text-accent-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                >
                  使用中
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  :disabled="settingsStore.saving"
                  @click="startEdit(profile)"
                >
                  编辑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  :disabled="settingsStore.saving"
                  @click="removeProfile(profile)"
                >
                  删除
                </Button>
              </li>
            </ul>

            <div v-if="!editing" class="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" @click="startCreate">
                新增模型
              </Button>
              <span v-if="status === 'saved'" class="text-muted-foreground text-xs">已保存</span>
              <span v-else-if="formError" class="text-destructive text-xs">{{ formError }}</span>
            </div>

            <form v-else class="space-y-4 rounded-lg border p-3" @submit.prevent="saveProfile">
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-medium">
                  {{ editingIsNew ? '新增模型' : '编辑模型' }}
                </h4>
                <Button type="button" variant="ghost" size="sm" @click="cancelEdit">取消</Button>
              </div>

              <div class="space-y-1.5">
                <label class="text-xs font-medium" for="ai-base-url">Base URL</label>
                <Input
                  id="ai-base-url"
                  v-model="baseUrl"
                  placeholder="https://api.openai.com/v1"
                  autocomplete="off"
                  spellcheck="false"
                />
              </div>

              <div class="space-y-1.5">
                <label class="text-xs font-medium" for="ai-model">模型</label>
                <Input
                  id="ai-model"
                  v-model="model"
                  placeholder="gpt-4o-mini / deepseek-chat"
                  autocomplete="off"
                  spellcheck="false"
                />
                <p class="text-muted-foreground text-xs">
                  填写服务商提供的模型名，翻译和对话都会用它发起请求。
                </p>
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
                <Button
                  type="button"
                  size="sm"
                  :disabled="settingsStore.saving"
                  @click="saveProfile"
                >
                  {{ settingsStore.saving ? '保存中…' : '保存' }}
                </Button>
                <span v-if="status === 'saved'" class="text-muted-foreground text-xs">已保存</span>
                <span v-else-if="formError" class="text-destructive text-xs">{{ formError }}</span>
              </div>
            </form>
          </section>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AiProfile, AppTheme } from '@renderer/types'
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
import { aiProfileLabel } from '@renderer/lib/ai'
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
const profiles = computed(() => settingsStore.aiProfiles)
// 默认只展示已保存的配置，点「新增模型」或「编辑」才展开表单
const editingId = ref<string | null>(null)
const editingIsNew = ref(true)
const baseUrl = ref('')
const apiKey = ref('')
const model = ref('')
const showKey = ref(false)
const status = ref<'idle' | 'saved'>('idle')
const formError = ref('')

const editing = computed(() => editingId.value !== null)

const createId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const resetForm = (): void => {
  editingId.value = null
  baseUrl.value = ''
  apiKey.value = ''
  model.value = ''
  showKey.value = false
  status.value = 'idle'
  formError.value = ''
}

const startCreate = (): void => {
  resetForm()
  editingId.value = createId()
  editingIsNew.value = true
}

const startEdit = (profile: AiProfile): void => {
  resetForm()
  editingId.value = profile.id
  editingIsNew.value = false
  baseUrl.value = profile.baseUrl
  apiKey.value = profile.apiKey
  model.value = profile.model
}

const cancelEdit = (): void => {
  resetForm()
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    settingsStore.clearError()
    resetForm()
  }
)

const normalizeBaseUrl = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return trimmed.replace(/\/+$/, '')
  } catch {
    return null
  }
}

const saveProfile = async (): Promise<void> => {
  formError.value = ''
  const id = editingId.value
  if (!id) return

  const normalized = normalizeBaseUrl(baseUrl.value)
  if (normalized === null) {
    formError.value = 'Base URL 需要是以 http:// 或 https:// 开头的地址'
    return
  }

  const entry: AiProfile = {
    id,
    baseUrl: normalized,
    apiKey: apiKey.value.trim(),
    model: model.value.trim()
  }
  const next = profiles.value.map((profile) => ({ ...profile }))
  const index = next.findIndex((profile) => profile.id === id)
  if (index >= 0) {
    next[index] = entry
  } else {
    next.push(entry)
  }

  // 当前激活的配置仍存在就保留，否则切到第一条（新增第一条时自动激活）
  const currentActiveId = settingsStore.activeAiProfile?.id
  const nextActiveId = next.some((profile) => profile.id === currentActiveId)
    ? currentActiveId
    : (next[0]?.id ?? '')

  const saved = await settingsStore.saveAiProfiles(next, nextActiveId)
  if (!saved) {
    formError.value = settingsStore.error || '保存失败'
    return
  }
  resetForm()
  status.value = 'saved'
}

const removeProfile = async (profile: AiProfile): Promise<void> => {
  formError.value = ''
  const next = profiles.value.filter((item) => item.id !== profile.id).map((item) => ({ ...item }))
  const currentActiveId = settingsStore.activeAiProfile?.id
  const nextActiveId = next.some((item) => item.id === currentActiveId)
    ? currentActiveId
    : (next[0]?.id ?? '')

  const saved = await settingsStore.saveAiProfiles(next, nextActiveId)
  if (!saved) {
    formError.value = settingsStore.error || '删除失败'
    return
  }
  if (editingId.value === profile.id) resetForm()
  status.value = 'saved'
}
</script>
