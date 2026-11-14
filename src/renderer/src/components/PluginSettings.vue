<template>
  <section class="space-y-4">
    <div>
      <h3 class="text-sm font-medium">{{ t('plugins.title') }}</h3>
      <p class="text-muted-foreground mt-1 text-xs">
        {{ t('plugins.description') }}
      </p>
    </div>

    <p v-if="store.error" class="text-destructive text-xs">{{ store.error }}</p>
    <p v-if="store.loading && store.plugins.length === 0" class="text-muted-foreground text-xs">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="store.plugins.length === 0" class="text-muted-foreground text-xs">
      {{ t('plugins.empty') }}
    </p>

    <ul v-else class="divide-y rounded-md border">
      <li v-for="plugin in store.plugins" :key="plugin.id" class="space-y-2 px-3 py-3">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm">
              {{ plugin.name }}
              <span class="text-muted-foreground text-xs">v{{ plugin.version }}</span>
              <span
                v-if="runtimeFor(plugin.id)"
                class="text-muted-foreground text-xs"
                data-testid="plugin-runtime"
              >
                · {{ runtimeLabel(plugin.id) }}
              </span>
            </p>
            <p v-if="plugin.description" class="text-muted-foreground text-xs">
              {{ plugin.description }}
            </p>
            <p v-if="runtimeFor(plugin.id)?.message" class="text-destructive text-xs">
              {{ runtimeFor(plugin.id)?.message }}
            </p>
            <p class="text-muted-foreground font-mono text-[10px]">{{ plugin.id }}</p>
          </div>
          <label
            class="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap"
          >
            <input
              type="checkbox"
              class="accent-primary size-3.5"
              :aria-label="t('plugins.enableAria', { name: plugin.name })"
              :checked="plugin.enabled"
              :disabled="!plugin.compatible || store.savingId === plugin.id"
              @change="toggle(plugin, $event)"
            />
            {{ store.savingId === plugin.id ? t('common.saving') : t('plugins.enable') }}
          </label>
        </div>

        <p v-if="!plugin.compatible" class="text-destructive text-xs">
          {{ t('plugins.incompatible') }}
        </p>

        <div v-if="plugin.permissions.length > 0" class="flex flex-wrap items-center gap-1">
          <span class="text-muted-foreground text-[10px]">{{ t('plugins.permissions') }}</span>
          <span
            v-for="permission in plugin.permissions"
            :key="permission"
            class="bg-accent text-accent-foreground rounded px-1.5 py-0.5 font-mono text-[10px]"
          >
            {{ permission }}
          </span>
        </div>
        <p v-else class="text-muted-foreground text-xs">{{ t('plugins.noPermissions') }}</p>

        <p v-if="plugin.commands.length > 0" class="text-muted-foreground text-xs">
          {{
            t('plugins.commands', {
              commands: plugin.commands.map((command) => command.title).join(', ')
            })
          }}
        </p>
      </li>
    </ul>

    <div v-if="store.issues.length > 0" class="space-y-1 rounded-md border border-dashed p-3">
      <p class="text-xs font-medium">{{ t('plugins.issues') }}</p>
      <p v-for="issue in store.issues" :key="issue.directoryName" class="text-destructive text-xs">
        {{ t('plugins.issueLine', { directory: issue.directoryName, message: issue.message }) }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import type { PluginInfo, PluginRuntimeState } from '@renderer/types'
import { t } from '@renderer/lib/i18n'
import { usePluginsStore } from '@renderer/store/plugins'

const store = usePluginsStore()
let unsubscribe: (() => void) | undefined

const runtimeLabel = (pluginId: string): string => {
  const state = store.runtimeFor(pluginId)
  if (!state) return ''
  return t(`plugins.runtime.${state.status}`)
}

const runtimeFor = (pluginId: string): PluginRuntimeState | undefined => store.runtimeFor(pluginId)

onMounted(() => {
  void store.load()
  void store.loadRuntime()
  unsubscribe = window.api?.onPluginRuntime?.(store.applyRuntime)
})

onBeforeUnmount(() => {
  unsubscribe?.()
})

const toggle = async (plugin: PluginInfo, event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const saved = await store.setEnabled(plugin.id, input.checked)
  // 主进程拒绝时把开关恢复原状，避免界面状态和持久化状态不一致
  if (!saved) input.checked = plugin.enabled
}
</script>
