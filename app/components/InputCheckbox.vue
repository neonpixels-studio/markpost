<template>
  <label
    class="row gap-3"
    :class="attrs.class"
    :style="[{ cursor: 'pointer' }, attrs.style as StyleValue]"
    v-bind="labelAttrs"
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
      @click.stop
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

// The <input> is visually hidden (opacity: 0, pointer-events: none) — it
// exists only for its native checkbox semantics and change event. Anything a
// caller expects to be seen, hovered, or clicked (class, style, title, and
// any listener) must stay on the <label>, the actual interactive surface;
// only attrs that describe the checkbox control itself (aria-*, name,
// required, disabled, etc.) forward onto the input.
//
// The input's `@click.stop` (template) matters here too: clicking the
// <label> makes the browser dispatch a second, synthetic click at its
// wrapped <input> (native label/control forwarding), which would otherwise
// bubble back up and fire a caller's forwarded @click on the label twice per
// user click. Stopping it there keeps the label's own click the only one a
// caller ever sees.
defineOptions({ inheritAttrs: false });
const attrs = useAttrs();
const labelAttrs = computed(() => {
  const entries = Object.entries(attrs).filter(
    ([key]) => key === "title" || key.startsWith("on"),
  );
  return Object.fromEntries(entries);
});
const inputAttrs = computed(() => {
  const {
    class: _presentationClass,
    style: _presentationStyle,
    title: _labelTitle,
    ...rest
  } = attrs;
  return Object.fromEntries(
    Object.entries(rest).filter(([key]) => !key.startsWith("on")),
  );
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
