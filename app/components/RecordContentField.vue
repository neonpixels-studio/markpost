<template>
  <div>
    <span class="kicker">content</span>
    <textarea
      v-if="isEditing"
      class="textarea mono"
      style="width: 100%; font-size: 13px; margin-top: 6px"
      rows="10"
      aria-label="Record content"
      :value="modelValue"
      :disabled="isSaving"
      @input="
        emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)
      "
    />
    <AppCodeBlock v-else lang="markdown" :copy="content">{{
      content
    }}</AppCodeBlock>

    <AppAlert
      v-if="saveError"
      tone="err"
      title="Failed to save"
      :closeable="false"
      style="margin-top: 14px"
    >
      {{ saveError }}
    </AppAlert>

    <div
      v-if="isEditing"
      class="row gap-3"
      style="justify-content: flex-end; margin-top: 14px"
    >
      <AppBtn
        variant="ghost"
        size="sm"
        :disabled="isSaving"
        @click="emit('cancel')"
        >cancel</AppBtn
      >
      <AppBtn
        variant="accent"
        size="sm"
        icon="check"
        :disabled="isSaving || !canSave"
        @click="emit('save')"
        >{{ isSaving ? "saving…" : "save" }}</AppBtn
      >
    </div>
  </div>
</template>

<script setup lang="ts">
// Bundles the content display/edit toggle with the save-error alert and the
// save/cancel row — everything that only appears once an edit is in flight —
// so RecordDetailModal.vue's own template stays under the project's
// complexity gate (see server/api/records: duplication is the other half of
// that gate, tackled by consolidating the PATCH error builders in
// server/utils/recordErrors.ts). The title validation message lives with the
// title input itself (RecordTitleField), not here, so it stays next to the
// field it describes.
defineProps<{
  content: string;
  modelValue: string;
  isEditing: boolean;
  isSaving: boolean;
  canSave: boolean;
  saveError: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  save: [];
  cancel: [];
}>();
</script>
