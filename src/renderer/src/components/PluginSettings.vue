<template>
  <section class="space-y-4">
    <div>
      <h3 class="text-sm font-medium">插件</h3>
      <p class="text-muted-foreground mt-1 text-xs">
        从应用数据目录的 plugins 文件夹发现插件。第三方插件默认关闭；启用后也只能使用 manifest
        声明的权限，写操作仍需逐次确认。
      </p>
    </div>

    <p v-if="store.error" class="text-destructive text-xs">{{ store.error }}</p>
    <p v-if="store.loading && store.plugins.length === 0" class="text-muted-foreground text-xs">
      加载中…
    </p>
    <p v-else-if="store.plugins.length === 0" class="text-muted-foreground text-xs">
      还没有发现插件。将插件目录放入应用数据目录下的 plugins 文件夹后重新打开设置。
    </p>

    <ul v-else class="divide-y rounded-md border">
      <li v-for="plugin in store.plugins" :key="plugin.id" class="space-y-2 px-3 py-3">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm">
              {{ plugin.name }}
              <span class="text-muted-foreground text-xs">v{{ plugin.version }}</span>
            </p>
            <p v-if="plugin.description" class="text-muted-foreground text-xs">
              {{ plugin.description }}
            </p>
            <p class="text-muted-foreground font-mono text-[10px]">{{ plugin.id }}</p>
          </div>
          <label
            class="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap"
          >
            <input
              type="checkbox"
              class="accent-primary size-3.5"
              :aria-label="`启用 ${plugin.name}`"
              :checked="plugin.enabled"
              :disabled="!plugin.compatible || store.savingId === plugin.id"
              @change="toggle(plugin, $event)"
            />
            {{ store.savingId === plugin.id ? '保存中…' : '启用' }}
          </label>
        </div>

        <p v-if="!plugin.compatible" class="text-destructive text-xs">
          与当前应用版本不兼容，无法启用。
        </p>

        <div v-if="plugin.permissions.length > 0" class="flex flex-wrap items-center gap-1">
          <span class="text-muted-foreground text-[10px]">权限</span>
          <span
            v-for="permission in plugin.permissions"
            :key="permission"
            class="bg-accent text-accent-foreground rounded px-1.5 py-0.5 font-mono text-[10px]"
          >
            {{ permission }}
          </span>
        </div>
        <p v-else class="text-muted-foreground text-xs">未声明权限</p>

        <p v-if="plugin.commands.length > 0" class="text-muted-foreground text-xs">
          命令：{{ plugin.commands.map((command) => command.title).join('、') }}
        </p>
      </li>
    </ul>

    <div v-if="store.issues.length > 0" class="space-y-1 rounded-md border border-dashed p-3">
      <p class="text-xs font-medium">无法加载的插件</p>
      <p v-for="issue in store.issues" :key="issue.directoryName" class="text-destructive text-xs">
        {{ issue.directoryName }}：{{ issue.message }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import type { PluginInfo } from '@renderer/types'
import { usePluginsStore } from '@renderer/store/plugins'

const store = usePluginsStore()

onMounted(() => {
  void store.load()
})

const toggle = async (plugin: PluginInfo, event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const saved = await store.setEnabled(plugin.id, input.checked)
  // 主进程拒绝时把开关恢复原状，避免界面状态和持久化状态不一致
  if (!saved) input.checked = plugin.enabled
}
</script>
