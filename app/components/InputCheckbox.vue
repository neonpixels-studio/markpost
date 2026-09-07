<template>
  <label class="row gap-3" style="cursor: pointer">
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
      :checked="modelValue"
      v-bind="attrs"
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
// Attrs like aria-label describe the actual checkbox control, not the
// wrapping <label> — forward them onto the real <input> instead of letting
// Vue's default fallthrough land them on the root element.
defineOptions({ inheritAttrs: false });
const attrs = useAttrs();

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
