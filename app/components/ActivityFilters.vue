<template>
  <div
    class="row between wrap gap-3"
    style="margin-bottom: 18px"
    data-testid="activity-filters"
  >
    <InputSegmented
      :model-value="kindFilter"
      :options="EVENT_KIND_FILTER_OPTIONS"
      :disabled="disabled"
      @update:model-value="$emit('update:kindFilter', $event)"
    />
    <InputSelect
      v-if="sources.length > 0"
      :model-value="sourceFilter"
      :options="sourceFilterOptions"
      :disabled="disabled"
      style="max-width: 220px"
      @update:model-value="$emit('update:sourceFilter', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import {
  EVENT_KIND_FILTER_OPTIONS,
  EVENT_SOURCE_FILTER_ALL,
} from "~/composables/useEvents";
import type { SourceResource } from "~/composables/useSources";

const props = withDefaults(
  defineProps<{
    kindFilter: string;
    sourceFilter: string;
    sources: SourceResource[];
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

defineEmits<{
  "update:kindFilter": [value: string];
  "update:sourceFilter": [value: string];
}>();

// "all sources" first, then one option per source keyed by uuid (the value
// filter[sourceId] expects) — labelled by name since that's the only
// user-facing identifier a source carries here (see useSources.ts).
const sourceFilterOptions = computed(() => [
  { value: EVENT_SOURCE_FILTER_ALL, label: "all sources" },
  ...props.sources.map((source) => ({
    value: source.attributes.uuid,
    label: source.attributes.name,
  })),
]);
</script>
