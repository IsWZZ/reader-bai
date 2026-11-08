<template>
  <div class="flex flex-col min-h-screen bg-background">
    <Toolbar />
    <div class="flex flex-1">
      <ActivityBar />
    </div>
  </div>
</template>

<script setup lang="ts">
import Toolbar from '@renderer/components/Toolbar.vue'
import ActivityBar from '@renderer/components/ActivityBar.vue'
</script>
