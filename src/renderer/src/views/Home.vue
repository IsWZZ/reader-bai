<template>
  <br />
  <div>
    <p class="text-lg font-bold">Home</p>
    <Button>Click me</Button>
  </div>
  <div>
    <Search :size="20" />
    <Settings :size="20" />
    <Home :size="20" />
    <BookOpen :size="20" />
  </div>
</template>

<script setup lang="ts">
import { Button } from '@renderer/components/ui/button'
import { Search, Settings, Home, BookOpen } from 'lucide-vue-next'
</script>
