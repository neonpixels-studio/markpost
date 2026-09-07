<template>
  <div
    class="row"
    role="button"
    tabindex="0"
    :aria-label="`Open record ${record.attributes.title}`"
    style="padding: 13px 18px; cursor: pointer; transition: background 0.1s"
    @click="emit('open', record.attributes.uuid)"
    @keydown.enter="emit('open', record.attributes.uuid)"
    @keydown.space.prevent="emit('open', record.attributes.uuid)"
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
    <span
      style="
        flex: 1;
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding-right: 16px;
      "
    >
      {{ record.attributes.title }}
    </span>
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

defineProps<{
  record: RecordResource;
  selected: boolean;
}>();

const emit = defineEmits<{
  open: [uuid: string];
  "toggle-select": [uuid: string];
  delete: [uuid: string];
}>();
</script>
