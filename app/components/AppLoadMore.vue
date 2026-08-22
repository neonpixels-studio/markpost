<template>
  <div class="row" style="justify-content: center; margin-top: 16px">
    <AppBtn
      size="sm"
      :icon="isLoading ? 'refresh' : 'chevD'"
      :disabled="isLoading"
      @click="$emit('load')"
      >{{ isLoading ? "loading…" : "load more" }}</AppBtn
    >
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    isLoading?: boolean;
  }>(),
  {
    isLoading: false,
  },
);

defineEmits<{
  load: [];
}>();
</script>
