<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent
      class="flex h-[520px] max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
    >
      <DialogHeader class="border-b px-5 py-4 pr-12">
        <DialogTitle>{{ t('settings.title') }}</DialogTitle>
        <DialogDescription>{{ t('settings.description') }}</DialogDescription>
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
          <section v-if="activeSection === 'basic'" class="space-y-6">
            <div class="space-y-4">
              <div>
                <h3 class="text-sm font-medium">{{ t('settings.basic.appearance.title') }}</h3>
                <p class="text-muted-foreground mt-1 text-xs">
                  {{ t('settings.basic.appearance.description') }}
                </p>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="option in themeOptions"
                  :key="option.value"
                  type="button"
                  :disabled="settingsStore.saving"
                  :class="[
                    'flex flex-col items-center gap-2 rounded-lg border p-4 text-xs transition-colors disabled:opacity-50',
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
            </div>

            <div class="space-y-4 border-t pt-4">
              <div>
                <h3 class="text-sm font-medium">{{ t('settings.basic.language.title') }}</h3>
                <p class="text-muted-foreground mt-1 text-xs">
                  {{ t('settings.basic.language.description') }}
                </p>
              </div>
              <div
                class="grid grid-cols-2 gap-2"
                role="group"
                :aria-label="t('settings.basic.language.label')"
              >
                <button
                  v-for="option in languageOptions"
                  :key="option.code"
                  type="button"
                  :disabled="settingsStore.saving"
                  :lang="option.code"
                  :aria-pressed="settingsStore.language === option.code"
                  :class="[
                    'rounded-lg border px-4 py-3 text-sm transition-colors disabled:opacity-50',
                    settingsStore.language === option.code
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'hover:bg-accent/60'
                  ]"
                  @click="settingsStore.setLanguage(option.code)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <span v-if="status === 'saved'" class="text-muted-foreground text-xs">
                {{ t('common.saved') }}
              </span>
              <span v-else-if="settingsStore.error" class="text-destructive text-xs">
                {{ settingsStore.error }}
              </span>
            </div>
          </section>

          <section v-else-if="activeSection === 'library'" class="space-y-6">
            <div class="space-y-4">
              <div>
                <h3 class="text-sm font-medium">{{ t('settings.library.title') }}</h3>
                <p class="text-muted-foreground mt-1 text-xs">
                  {{ t('settings.library.description') }}
                </p>
              </div>

              <div class="space-y-1.5">
                <label class="text-xs font-medium" for="library-directory">
                  {{ t('settings.library.directoryLabel') }}
                </label>
                <Input
                  id="library-directory"
                  :model-value="settingsStore.libraryDirectory"
                  readonly
                  class="font-mono text-xs"
                  :placeholder="t('common.loading')"
                />
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  :disabled="settingsStore.saving"
                  @click="chooseLibraryDirectory"
                >
                  {{ settingsStore.saving ? t('common.saving') : t('common.chooseFolder') }}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  :disabled="settingsStore.saving"
                  @click="resetLibraryDirectory"
                >
                  {{ t('common.resetDefault') }}
                </Button>
                <span v-if="status === 'saved'" class="text-muted-foreground text-xs">
                  {{ t('common.saved') }}
                </span>
                <span v-else-if="formError" class="text-destructive text-xs">{{ formError }}</span>
              </div>

              <p class="text-muted-foreground text-xs">
                {{ t('settings.library.removeNote') }}
              </p>
            </div>

            <div class="space-y-4 border-t pt-4">
              <div>
                <h3 class="text-sm font-medium">{{ t('settings.storage.title') }}</h3>
                <p class="text-muted-foreground mt-1 text-xs">
                  {{ t('settings.storage.description') }}
                </p>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  :disabled="clearingCache"
                  @click="clearCache"
                >
                  {{ clearingCache ? t('settings.storage.clearing') : t('settings.storage.clear') }}
                </Button>
                <span v-if="cacheStatus === 'cleared'" class="text-muted-foreground text-xs">
                  {{ t('settings.storage.cleared') }}
                </span>
                <span v-else-if="cacheError" class="text-destructive text-xs">{{
                  cacheError
                }}</span>
              </div>

              <p class="text-muted-foreground text-xs">
                {{ t('settings.storage.note') }}
              </p>
            </div>
          </section>

          <section v-else-if="activeSection === 'plugins'" class="space-y-4">
            <PluginSettings />
          </section>

          <section v-else class="space-y-4">
            <div>
              <h3 class="text-sm font-medium">{{ t('settings.ai.title') }}</h3>
              <p class="text-muted-foreground mt-1 text-xs">
                {{ t('settings.ai.description') }}
              </p>
            </div>

            <p
              v-if="settingsStore.settings.keyStorage === 'plaintext'"
              class="text-destructive text-xs"
            >
              {{ t('settings.ai.plaintextWarning') }}
            </p>

            <p v-if="profiles.length === 0" class="text-muted-foreground text-xs">
              {{ t('settings.ai.empty') }}
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
                    {{ profile.baseUrl || t('settings.ai.noBaseUrl') }}
                  </p>
                </div>
                <span
                  v-if="profile.id === settingsStore.activeAiProfile?.id"
                  class="bg-accent text-accent-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                >
                  {{ t('settings.ai.inUse') }}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  :disabled="settingsStore.saving"
                  @click="startEdit(profile)"
                >
                  {{ t('common.edit') }}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  :disabled="settingsStore.saving"
                  @click="removeProfile(profile)"
                >
                  {{ t('common.delete') }}
                </Button>
              </li>
            </ul>

            <div v-if="!editing" class="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" @click="startCreate">
                {{ t('settings.ai.add') }}
              </Button>
              <span v-if="status === 'saved'" class="text-muted-foreground text-xs">
                {{ t('common.saved') }}
              </span>
              <span v-else-if="formError" class="text-destructive text-xs">{{ formError }}</span>
            </div>

            <form v-else class="space-y-4 rounded-lg border p-3" @submit.prevent="saveProfile">
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-medium">
                  {{ editingIsNew ? t('settings.ai.add') : t('settings.ai.editTitle') }}
                </h4>
                <Button type="button" variant="ghost" size="sm" @click="cancelEdit">
                  {{ t('common.cancel') }}
                </Button>
              </div>

              <div class="space-y-1.5">
                <label class="text-xs font-medium" for="ai-base-url">
                  {{ t('settings.ai.form.baseUrl') }}
                </label>
                <Input
                  id="ai-base-url"
                  v-model="baseUrl"
                  placeholder="https://api.openai.com/v1"
                  autocomplete="off"
                  spellcheck="false"
                />
              </div>

              <div class="space-y-1.5">
                <label class="text-xs font-medium" for="ai-model">
                  {{ t('settings.ai.form.model') }}
                </label>
                <Input
                  id="ai-model"
                  v-model="model"
                  placeholder="gpt-4o-mini / deepseek-chat"
                  autocomplete="off"
                  spellcheck="false"
                />
                <p class="text-muted-foreground text-xs">
                  {{ t('settings.ai.form.modelHint') }}
                </p>
              </div>

              <div class="space-y-1.5">
                <label class="text-xs font-medium" for="ai-api-key">
                  {{ t('settings.ai.form.apiKey') }}
                </label>
                <div class="relative">
                  <Input
                    id="ai-api-key"
                    v-model="apiKey"
                    :type="showKey ? 'text' : 'password'"
                    class="pr-9"
                    :placeholder="editingProfileHasKey ? t('settings.ai.form.keepKey') : 'sk-...'"
                    autocomplete="off"
                    spellcheck="false"
                  />
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-9 items-center justify-center"
                    :aria-label="
                      showKey ? t('settings.ai.form.hideKey') : t('settings.ai.form.showKey')
                    "
                    @click="showKey = !showKey"
                  >
                    <EyeOff v-if="showKey" class="size-4" />
                    <Eye v-else class="size-4" />
                  </button>
                </div>
                <p class="text-muted-foreground text-xs">
                  <template v-if="editingProfileHasKey">
                    {{ t('settings.ai.form.keySaved') }}
                  </template>
                  <template v-else>
                    {{ t('settings.ai.form.keyNew') }}
                  </template>
                </p>
              </div>

              <div class="flex items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  :disabled="settingsStore.saving"
                  @click="saveProfile"
                >
                  {{ settingsStore.saving ? t('common.saving') : t('common.save') }}
                </Button>
                <span v-if="status === 'saved'" class="text-muted-foreground text-xs">
                  {{ t('common.saved') }}
                </span>
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
import type { AiProfile, AiProfilePatch, AppTheme } from '@renderer/types'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import PluginSettings from '@renderer/components/PluginSettings.vue'
import { useSettingsStore } from '@renderer/store/settings'
import { aiProfileLabel } from '@renderer/lib/ai'
import { availableLocales, t } from '@renderer/lib/i18n'
import {
  Eye,
  EyeOff,
  FolderOpen,
  Moon,
  Puzzle,
  SlidersHorizontal,
  Sparkles,
  Sun
} from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const settingsStore = useSettingsStore()

type SectionId = 'basic' | 'ai' | 'library' | 'plugins'
type IconComponent = typeof SlidersHorizontal

const sections = computed<{ id: SectionId; label: string; icon: IconComponent }[]>(() => [
  { id: 'basic', label: t('settings.section.basic'), icon: SlidersHorizontal },
  { id: 'library', label: t('settings.section.libraryStorage'), icon: FolderOpen },
  { id: 'ai', label: t('settings.section.ai'), icon: Sparkles },
  { id: 'plugins', label: t('settings.section.plugins'), icon: Puzzle }
])

const themeOptions = computed<{ value: AppTheme; label: string; icon: IconComponent }[]>(() => [
  { value: 'light', label: t('settings.basic.theme.light'), icon: Sun },
  { value: 'dark', label: t('settings.basic.theme.dark'), icon: Moon }
])

const languageOptions = availableLocales

const activeSection = ref<SectionId>('basic')
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
const clearingCache = ref(false)
const cacheStatus = ref<'idle' | 'cleared'>('idle')
const cacheError = ref('')

const editing = computed(() => editingId.value !== null)
const editingProfileHasKey = computed(() =>
  editingId.value === null
    ? false
    : Boolean(profiles.value.find((profile) => profile.id === editingId.value)?.hasApiKey)
)

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
  // 渲染进程拿不到已保存的 Key，编辑时始终留空
  apiKey.value = ''
  model.value = profile.model
}

const cancelEdit = (): void => {
  resetForm()
}

const resetCacheState = (): void => {
  cacheStatus.value = 'idle'
  cacheError.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    settingsStore.clearError()
    resetForm()
    resetCacheState()
  }
)

watch(activeSection, () => {
  status.value = 'idle'
  formError.value = ''
  resetCacheState()
})

const saveLibraryDirectory = async (directory: string): Promise<void> => {
  formError.value = ''
  const saved = await settingsStore.setLibraryDirectory(directory)
  if (!saved) {
    formError.value = settingsStore.error || t('settings.ai.error.saveFailed')
    return
  }
  status.value = 'saved'
}

const chooseLibraryDirectory = async (): Promise<void> => {
  formError.value = ''
  const api = window.api
  if (!api?.chooseDirectory) {
    formError.value = t('settings.library.error.pickerUnavailable')
    return
  }
  try {
    const directory = await api.chooseDirectory()
    if (directory) await saveLibraryDirectory(directory)
  } catch (e) {
    formError.value = e instanceof Error ? e.message : t('settings.library.error.pickerFailed')
  }
}

const resetLibraryDirectory = (): Promise<void> => saveLibraryDirectory('')

const clearCache = async (): Promise<void> => {
  if (clearingCache.value) return
  cacheStatus.value = 'idle'
  cacheError.value = ''
  const api = window.api
  if (!api?.clearCache) {
    cacheError.value = t('settings.storage.error.unavailable')
    return
  }

  clearingCache.value = true
  try {
    await api.clearCache()
    cacheStatus.value = 'cleared'
  } catch (e) {
    cacheStatus.value = 'idle'
    cacheError.value = e instanceof Error ? e.message : t('settings.storage.error.failed')
  } finally {
    clearingCache.value = false
  }
}

const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

// 与主进程策略保持一致：HTTPS，或指向本机服务的 http
const normalizeBaseUrl = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'https:') return trimmed.replace(/\/+$/, '')
    if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
      return trimmed.replace(/\/+$/, '')
    }
    return null
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
    formError.value = t('settings.ai.error.baseUrl')
    return
  }
  const trimmedModel = model.value.trim()
  if (!trimmedModel) {
    formError.value = t('settings.ai.error.modelRequired')
    return
  }

  const typedKey = apiKey.value.trim()
  if (editingIsNew.value && !typedKey) {
    formError.value = t('settings.ai.error.keyRequired')
    return
  }

  // 未重新填写 Key 的配置不带 apiKey，主进程会保留原有 Key
  const next: AiProfilePatch[] = profiles.value.map((profile) => ({
    id: profile.id,
    baseUrl: profile.baseUrl,
    model: profile.model
  }))
  const entry: AiProfilePatch = {
    id,
    baseUrl: normalized,
    model: trimmedModel
  }
  if (typedKey) entry.apiKey = typedKey
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
    formError.value = settingsStore.error || t('settings.ai.error.saveFailed')
    return
  }
  resetForm()
  status.value = 'saved'
}

const removeProfile = async (profile: AiProfile): Promise<void> => {
  formError.value = ''
  const next: AiProfilePatch[] = profiles.value
    .filter((item) => item.id !== profile.id)
    .map((item) => ({ id: item.id, baseUrl: item.baseUrl, model: item.model }))
  const currentActiveId = settingsStore.activeAiProfile?.id
  const nextActiveId = next.some((item) => item.id === currentActiveId)
    ? currentActiveId
    : (next[0]?.id ?? '')

  const saved = await settingsStore.saveAiProfiles(next, nextActiveId)
  if (!saved) {
    formError.value = settingsStore.error || t('settings.ai.error.deleteFailed')
    return
  }
  if (editingId.value === profile.id) resetForm()
  status.value = 'saved'
}
</script>
