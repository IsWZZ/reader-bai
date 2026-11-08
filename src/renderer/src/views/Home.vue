<template>
  <div class="flex flex-col min-h-screen bg-background">
    <Toolbar />
    <div class="flex flex-1">
      <ActivityBar />
      <main class="p-4">
        <p class="text-lg font-bold">Home</p>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import Toolbar from '@renderer/components/Toolbar.vue'
import ActivityBar from '@renderer/components/ActivityBar.vue'
</script>
