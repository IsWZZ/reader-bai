<template>
  <div class="bg-card flex h-full min-h-0 flex-col overflow-hidden rounded-lg border">
    <header class="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      <Puzzle class="text-muted-foreground size-4 shrink-0" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        {{ pluginName }} · {{ view.title }}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('plugins.view.close')"
        @click="emit('close')"
      >
        <X class="size-4" />
      </Button>
    </header>

    <iframe
      ref="frameRef"
      :src="src"
      :title="`${pluginName} · ${view.title}`"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      class="min-h-0 w-full flex-1 border-0 bg-white"
      @load="sendInit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Puzzle, X } from 'lucide-vue-next'
import { Button } from '@renderer/components/ui/button'
import { t } from '@renderer/lib/i18n'
import { pluginViewUrl } from '@renderer/lib/plugin-view'
import type { PluginViewInfo } from '@renderer/types'

const props = defineProps<{
  pluginId: string
  pluginName: string
  view: PluginViewInfo
}>()

const emit = defineEmits<{ close: [] }>()

const MAX_REQUEST_ID = 100
const MAX_ERROR_CHARS = 1000

const frameRef = ref<HTMLIFrameElement | null>(null)
const src = computed(() => pluginViewUrl(props.pluginId, props.view.entry))

const post = (message: unknown): void => {
  frameRef.value?.contentWindow?.postMessage(message, '*')
}

const sendInit = (): void => {
  post({
    type: 'reader-bai:init',
    pluginId: props.pluginId,
    viewId: props.view.id,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  })
}

const errorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  // ipcRenderer.invoke 会带上通道前缀，插件 UI 只需要可读的业务错误
  const message = raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}…` : message
}

interface ViewRequest {
  requestId: string
  method: string
  params?: unknown
}

const readRequest = (data: unknown): ViewRequest | null => {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  if (record.type !== 'reader-bai:request') return null
  if (
    typeof record.requestId !== 'string' ||
    !record.requestId ||
    record.requestId.length > MAX_REQUEST_ID
  ) {
    return null
  }
  if (typeof record.method !== 'string' || !record.method) return null
  return { requestId: record.requestId, method: record.method, params: record.params }
}

const handleRequest = async (request: ViewRequest): Promise<void> => {
  const api = window.api
  if (!api?.pluginViewRequest) {
    post({
      type: 'reader-bai:response',
      requestId: request.requestId,
      ok: false,
      error: '当前环境不支持插件视图请求'
    })
    return
  }

  try {
    const result = await api.pluginViewRequest(
      props.pluginId,
      props.view.id,
      request.method,
      request.params
    )
    post({ type: 'reader-bai:response', requestId: request.requestId, ok: true, result })
  } catch (error) {
    post({
      type: 'reader-bai:response',
      requestId: request.requestId,
      ok: false,
      error: errorMessage(error)
    })
  }
}

const handleMessage = (event: MessageEvent): void => {
  // 只接受当前 iframe 发来的消息；其他窗口和插件通信一律忽略
  if (!frameRef.value || event.source !== frameRef.value.contentWindow) return
  const request = readRequest(event.data)
  if (request) void handleRequest(request)
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage)
})
</script>
