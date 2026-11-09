<template>
  <div class="flex flex-col h-screen bg-background overflow-hidden">
    <Toolbar />
    <div class="flex flex-1 overflow-hidden">
      <ActivityBar />
      <LibraryPanel />
      <main class="flex-1 overflow-y-auto p-4">
        <p class="text-muted-foreground">阅读区</p>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import Toolbar from '@renderer/components/Toolbar.vue'
import ActivityBar from '@renderer/components/ActivityBar.vue'
import LibraryPanel from '@renderer/components/LibraryPanel.vue'
</script>
