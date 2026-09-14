<template>
  <div
    class="row between"
    style="align-items: flex-start; gap: 12px; margin-bottom: 14px"
  >
    <div v-if="isEditing" class="col" style="flex: 1; gap: 4px">
      <input
        ref="inputElement"
        class="input"
        style="font-size: 18px; font-weight: 600"
        aria-label="Record title"
        :aria-invalid="Boolean(titleError)"
        :aria-describedby="titleError ? titleErrorId : undefined"
        :value="modelValue"
        :disabled="disabled"
        @input="
          emit('update:modelValue', ($event.target as HTMLInputElement).value)
        "
      />
      <span
        v-if="titleError"
        :id="titleErrorId"
        class="mono"
        style="font-size: 12px; color: var(--err)"
        >{{ titleError }}</span
      >
    </div>
    <h3
      v-else
      style="font-size: 18px; font-weight: 600; letter-spacing: -0.01em"
    >
      {{ title }}
    </h3>
    <AppBtn
      v-if="!isEditing"
      variant="ghost"
      size="sm"
      icon="edit"
      style="flex: none"
      @click="emit('edit')"
      >edit</AppBtn
    >
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  title: string;
  modelValue: string;
  isEditing: boolean;
  disabled: boolean;
  titleError?: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  edit: [];
}>();

// A hardcoded id would collide with a second RecordDetailModal edit form on
// the same page (or reused instance) and break aria-describedby's reference
// — see TokenExpiryFields.vue's hintId for the same fix.
const titleErrorId = useId();

const inputElement = ref<HTMLInputElement | null>(null);

// The edit button that had focus unmounts the instant isEditing flips true
// (it's only rendered while !isEditing), which drops browser focus to
// <body> with nothing announced to screen readers. Move focus into the
// input that replaced it instead of leaving that gap — nextTick so the
// v-if has actually swapped in the input before .focus() runs.
watch(
  () => props.isEditing,
  async (editing) => {
    if (!editing) {
      return;
    }
    await nextTick();
    inputElement.value?.focus();
  },
);
</script>
