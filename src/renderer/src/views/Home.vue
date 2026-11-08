<template>
  <div class="flex flex-col min-h-screen bg-background">
    <Toolbar />
    <div class="flex flex-1">
      <ActivityBar />
      <LibraryPanel />
      <main class="flex-1 p-4">
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
