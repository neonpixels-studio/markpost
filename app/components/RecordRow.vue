<template>
  <div
    class="row"
    style="padding: 13px 18px; transition: background 0.1s"
    @mouseenter="
      ($event.currentTarget as HTMLElement).style.background = 'var(--bg-2)'
    "
    @mouseleave="
      ($event.currentTarget as HTMLElement).style.background = 'transparent'
    "
  >
    <span style="width: 28px" @click.stop @keydown.stop>
      <InputCheckbox
        :model-value="selected"
        :aria-label="`Select record ${record.attributes.title}`"
        @update:model-value="emit('toggle-select', record.attributes.uuid)"
      />
    </span>
    <span class="row gap-2" style="width: 120px">
      <AppIcon
        :name="sourceTypeIcon(record.attributes.sourceType)"
        :size="15"
        :style="{ color: 'var(--accent)', flex: 'none' }"
      />
      <span
        class="mono"
        style="
          font-size: 11.5px;
          color: var(--ink-2);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        "
      >
        {{
          formatSourceLabel(
            record.attributes.source,
            record.attributes.sourceType,
          )
        }}
      </span>
    </span>
    <button
      type="button"
      class="record-open-btn"
      :aria-label="`Open record ${record.attributes.title}`"
      style="
        flex: 1;
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding-right: 16px;
        text-align: left;
        background: none;
        border: 0;
        padding-left: 0;
        font-family: inherit;
        color: inherit;
        cursor: pointer;
      "
      @click="emit('open', record.attributes.uuid)"
    >
      {{ record.attributes.title }}
    </button>
    <span
      class="mono"
      :style="{
        width: '230px',
        fontSize: '11.5px',
        color: record.attributes.filePath ? 'var(--info)' : 'var(--ink-3)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }"
    >
      {{ record.attributes.filePath ?? "—" }}
    </span>
    <span style="width: 90px">
      <AppBadge :tone="STATUS_TONE_MAP[record.attributes.status] ?? ''" dot>{{
        record.attributes.status
      }}</AppBadge>
    </span>
    <span
      class="mono faint"
      style="width: 80px; text-align: right; font-size: 11.5px"
    >
      {{ formatRelativeTime(record.attributes.createdAt) }}
    </span>
    <span style="width: 44px; text-align: right" @click.stop @keydown.stop>
      <AppBtn
        variant="ghost"
        size="sm"
        icon="trash"
        title="Delete record"
        :aria-label="`Delete record ${record.attributes.title}`"
        :disabled="disabled"
        @click="emit('delete', record.attributes.uuid)"
      ></AppBtn>
    </span>
  </div>
</template>

<script setup lang="ts">
import {
  formatRelativeTime,
  formatSourceLabel,
  sourceTypeIcon,
  STATUS_TONE_MAP,
  type RecordResource,
} from "~/composables/useRecords";

withDefaults(
  defineProps<{
    record: RecordResource;
    selected: boolean;
    // Disables just the per-row delete action — set while a bulk action is
    // in flight so a row delete can't fire a second, concurrent request.
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{
  open: [uuid: string];
  "toggle-select": [uuid: string];
  delete: [uuid: string];
}>();
</script>
