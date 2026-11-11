<script setup lang="ts">
import type { DropdownMenuLabelProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import { DropdownMenuLabel } from 'reka-ui'

const props = defineProps<
  DropdownMenuLabelProps & {
    class?: HTMLAttributes['class']
    inset?: boolean
  }
>()

const delegatedProps = reactiveOmit(props, 'class', 'inset')
</script>

<template>
  <DropdownMenuLabel
    data-slot="dropdown-menu-label"
    v-bind="delegatedProps"
    :class="
      cn(
        'px-2 py-1.5 text-xs font-medium text-muted-foreground',
        props.inset && 'pl-8',
        props.class
      )
    "
  >
    <slot />
  </DropdownMenuLabel>
</template>
