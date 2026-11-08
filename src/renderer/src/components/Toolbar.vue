<template>
  <div class="flex items-center justify-center gap-2 px-4 py-1.5 bg-background border-b">
    <div class="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm">
        <Home class="size-4" />
      </Button>
      <Button variant="ghost" size="icon-sm">
        <BookOpen class="size-4" />
      </Button>
    </div>
    <div class="flex-1 max-w-md">
      <Input v-model="searchQuery" placeholder="Search..." class="w-full" />
    </div>
    <div class="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm">
        <Settings class="size-4" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Home, BookOpen, Settings } from 'lucide-vue-next'

const searchQuery = ref('')
</script>
