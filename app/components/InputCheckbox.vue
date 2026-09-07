<template>
  <label
    class="row gap-3"
    :class="attrs.class"
    :style="[{ cursor: 'pointer' }, attrs.style as StyleValue]"
  >
    <span
      :style="{
        width: '19px',
        height: '19px',
        borderRadius: '5px',
        border: modelValue
          ? '1.5px solid var(--accent)'
          : '1.5px solid var(--line-2)',
        background: modelValue ? 'var(--accent)' : 'transparent',
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
        transition: 'all .15s',
        outline: focused ? '2px solid var(--accent)' : 'none',
        outlineOffset: '2px',
      }"
    >
      <AppIcon
        v-if="modelValue"
        name="check"
        :size="13"
        :stroke-width="3"
        :style="{ color: '#fff' }"
      />
    </span>
    <input
      type="checkbox"
      v-bind="inputAttrs"
      :checked="modelValue"
      style="position: absolute; opacity: 0; pointer-events: none"
      @change="
        emit('update:modelValue', ($event.target as HTMLInputElement).checked)
      "
      @focus="focused = true"
      @blur="focused = false"
    />
    <span
      :style="{
        fontSize: '14px',
        color: modelValue ? 'var(--ink)' : 'var(--ink-2)',
      }"
    >
      {{ label }}
    </span>
  </label>
</template>

<script setup lang="ts">
import type { StyleValue } from "vue";

// Non-presentational attrs (e.g. aria-label) describe the actual checkbox
// control, not the wrapping <label> — forward those onto the real <input>
// instead of letting Vue's default fallthrough land them on the root. class
// and style stay on the <label> (the visible root), since a caller styling
// this component means the visible element, not the invisible native input.
defineOptions({ inheritAttrs: false });
const attrs = useAttrs();
const inputAttrs = computed(() => {
  const {
    class: _presentationClass,
    style: _presentationStyle,
    ...rest
  } = attrs;
  return rest;
});

const focused = ref(false);

withDefaults(
  defineProps<{
    modelValue?: boolean;
    label?: string;
  }>(),
  {
    modelValue: false,
    label: "",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();
</script>
