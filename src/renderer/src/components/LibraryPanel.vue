<template>
  <div class="flex rounded-lg border" :style="{ width: width + 'px' }">
    <SidebarProvider :default-open="true">
      <Sidebar collapsible="none" class="w-full h-full">
        <SidebarContent>
          <!-- 头部标题 -->
          <SidebarHeader class="border-b px-4 py-1">
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                论文库
              </h2>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="ghost" size="icon-sm" class="rounded-lg">
                    <Plus class="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">导入论文</TooltipContent>
              </Tooltip>
            </div>
          </SidebarHeader>

          <!-- 论文列表 -->
          <div class="flex-1 overflow-y-auto">
            <!-- 空状态 -->
            <div
              v-if="papers.length === 0"
              class="flex flex-col items-center justify-center h-full text-center p-6"
            >
              <LibraryBig class="size-12 text-muted-foreground/40 mb-3" />
              <p class="text-sm text-muted-foreground">暂无论文</p>
              <p class="text-xs text-muted-foreground/70 mt-1">导入论文后显示在此处</p>
            </div>

            <!-- 论文列表 -->
            <SidebarGroup v-else>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem v-for="paper in papers" :key="paper.id">
                    <SidebarMenuButton>
                      <FileText class="size-4" />
                      <span class="truncate">{{ paper.title }}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from '@renderer/components/ui/sidebar'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@renderer/components/ui/tooltip'
import { LibraryBig, FileText, Plus } from 'lucide-vue-next'

interface Paper {
  id: string
  title: string
}

// 模拟数据，后续接入真实数据
const papers = ref<Paper[]>([])

// 从父组件接收宽度
defineProps<{
  width: number
}>()
</script>
