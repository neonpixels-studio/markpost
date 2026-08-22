<template>
  <div class="seg" role="radiogroup">
    <button
      v-for="option in normalizedOptions"
      :key="option.value"
      :class="modelValue === option.value ? 'on' : ''"
      type="button"
      role="radio"
      :aria-checked="modelValue === option.value"
      :disabled="disabled"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
type Option = string | { value: string; label: string };

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: readonly Option[];
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const normalizedOptions = computed(() =>
  props.options.map((option) => {
    if (typeof option === "string") {
      return { value: option, label: option };
    }
    return option;
  }),
);
</script>
