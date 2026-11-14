<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent
      class="flex h-[520px] max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
    >
      <DialogHeader class="border-b px-5 py-4 pr-12">
        <DialogTitle>设置</DialogTitle>
        <DialogDescription>调整应用外观、AI 服务、论文库与插件</DialogDescription>
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
          <section v-if="activeSection === 'library'" class="space-y-4">
            <div>
              <h3 class="text-sm font-medium">论文库存储位置</h3>
              <p class="text-muted-foreground mt-1 text-xs">
                新导入的 PDF 会复制到此目录，原文件保留；已有论文保持原路径。
              </p>
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-medium" for="library-directory">存储目录</label>
              <Input
                id="library-directory"
                :model-value="settingsStore.libraryDirectory"
                readonly
                class="font-mono text-xs"
                placeholder="加载中…"
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
                {{ settingsStore.saving ? '保存中…' : '选择文件夹' }}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                :disabled="settingsStore.saving"
                @click="resetLibraryDirectory"
              >
                恢复默认
              </Button>
              <span v-if="status === 'saved'" class="text-muted-foreground text-xs">已保存</span>
              <span v-else-if="formError" class="text-destructive text-xs">{{ formError }}</span>
            </div>

            <p class="text-muted-foreground text-xs">
              从书库移除论文只会删除记录，不会删除此目录中的文件。
            </p>
          </section>

          <section v-else-if="activeSection === 'storage'" class="space-y-4">
            <div>
              <h3 class="text-sm font-medium">Electron 缓存</h3>
              <p class="text-muted-foreground mt-1 text-xs">
                清理 Chromium 的网页缓存、代码缓存和 DNS 缓存；不会删除书库、标注、设置或 API Key。
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
                {{ clearingCache ? '清理中…' : '清理缓存' }}
              </Button>
              <span v-if="cacheStatus === 'cleared'" class="text-muted-foreground text-xs">
                缓存已清理
              </span>
              <span v-else-if="cacheError" class="text-destructive text-xs">{{ cacheError }}</span>
            </div>

            <p class="text-muted-foreground text-xs">
              清理后，页面上的离线资源会在下次加载时重新获取。
            </p>
          </section>

          <section v-else-if="activeSection === 'appearance'" class="space-y-4">
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

          <section v-else-if="activeSection === 'plugins'" class="space-y-4">
            <PluginSettings />
          </section>

          <section v-else class="space-y-4">
            <div>
              <h3 class="text-sm font-medium">AI 服务</h3>
              <p class="text-muted-foreground mt-1 text-xs">
                保存多份 OpenAI 兼容接口配置，在右侧辅助面板的下拉中选择使用哪一个。
              </p>
            </div>

            <p
              v-if="settingsStore.settings.keyStorage === 'plaintext'"
              class="text-destructive text-xs"
            >
              系统安全存储不可用，API Key 将以明文保存在本机设置文件中。
            </p>

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
                    :placeholder="editingProfileHasKey ? '留空表示保持现有 Key' : 'sk-...'"
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
                  <template v-if="editingProfileHasKey">
                    已保存 Key，渲染进程拿不到它；留空表示保持不变。
                  </template>
                  <template v-else>
                    API Key 只在主进程中保存和使用，系统支持时会加密存储。
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
import {
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
  Moon,
  Palette,
  Puzzle,
  Sparkles,
  Sun
} from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const settingsStore = useSettingsStore()

type SectionId = 'appearance' | 'ai' | 'library' | 'plugins' | 'storage'

const sections: { id: SectionId; label: string; icon: typeof Palette }[] = [
  { id: 'library', label: '论文库', icon: FolderOpen },
  { id: 'storage', label: '存储', icon: HardDrive },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'ai', label: 'AI 服务', icon: Sparkles },
  { id: 'plugins', label: '插件', icon: Puzzle }
]

const themeOptions: { value: AppTheme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon }
]

const activeSection = ref<SectionId>('library')
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
    formError.value = settingsStore.error || '保存失败'
    return
  }
  status.value = 'saved'
}

const chooseLibraryDirectory = async (): Promise<void> => {
  formError.value = ''
  const api = window.api
  if (!api?.chooseDirectory) {
    formError.value = '当前环境无法选择文件夹'
    return
  }
  try {
    const directory = await api.chooseDirectory()
    if (directory) await saveLibraryDirectory(directory)
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '选择文件夹失败'
  }
}

const resetLibraryDirectory = (): Promise<void> => saveLibraryDirectory('')

const clearCache = async (): Promise<void> => {
  if (clearingCache.value) return
  cacheStatus.value = 'idle'
  cacheError.value = ''
  const api = window.api
  if (!api?.clearCache) {
    cacheError.value = '当前环境无法清理缓存'
    return
  }

  clearingCache.value = true
  try {
    await api.clearCache()
    cacheStatus.value = 'cleared'
  } catch (e) {
    cacheStatus.value = 'idle'
    cacheError.value = e instanceof Error ? e.message : '清理缓存失败'
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
    formError.value = 'Base URL 需要是 HTTPS 地址；本机服务可使用 http://localhost'
    return
  }
  const trimmedModel = model.value.trim()
  if (!trimmedModel) {
    formError.value = '请填写模型名称'
    return
  }

  const typedKey = apiKey.value.trim()
  if (editingIsNew.value && !typedKey) {
    formError.value = '新增配置需要填写 API Key'
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
    formError.value = settingsStore.error || '保存失败'
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
    formError.value = settingsStore.error || '删除失败'
    return
  }
  if (editingId.value === profile.id) resetForm()
  status.value = 'saved'
}
</script>
