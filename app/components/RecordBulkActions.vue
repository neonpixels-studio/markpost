<template>
  <div
    class="card row between wrap gap-3"
    style="padding: 10px 14px; margin-bottom: 14px"
  >
    <span class="mono" style="font-size: 12px; color: var(--ink-2)"
      >{{ selectedCount }} selected</span
    >
    <div class="row wrap gap-2">
      <AppBtn
        v-for="status in RECORD_STATUS_VALUES"
        :key="status"
        size="sm"
        :disabled="disabled"
        @click="emit('mark-status', status)"
        >mark {{ status }}</AppBtn
      >
      <AppBtn
        size="sm"
        variant="ghost"
        :disabled="disabled"
        @click="emit('delete-selected')"
        >delete selected</AppBtn
      >
      <AppBtn size="sm" variant="ghost" @click="emit('clear')">clear</AppBtn>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  RECORD_STATUS_VALUES,
  type RecordStatus,
} from "~/composables/useRecords";

defineProps<{
  selectedCount: number;
  disabled: boolean;
}>();

const emit = defineEmits<{
  "mark-status": [status: RecordStatus];
  "delete-selected": [];
  clear: [];
}>();
</script>
