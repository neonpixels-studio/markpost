<template>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Record detail"
    style="
      position: fixed;
      inset: 0;
      background: color-mix(in oklab, #000 46%, transparent);
      display: grid;
      place-items: center;
      z-index: 60;
      padding: 24px;
    "
    @mousedown="handleBackdropMousedown"
    @mouseup="handleBackdropMouseup"
    @click="handleBackdropClick"
  >
    <div
      ref="cardElement"
      class="card"
      tabindex="-1"
      style="
        width: 640px;
        max-width: 100%;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: var(--sh-pop);
        padding: 24px;
        outline: none;
      "
    >
      <div class="row between" style="margin-bottom: 18px">
        <span class="kicker">record detail</span>
        <AppBtn variant="ghost" size="sm" icon="x" @click="emit('close')"
          >close</AppBtn
        >
      </div>

      <div
        v-if="isLoading"
        class="col"
        style="
          align-items: center;
          padding: 40px 0;
          color: var(--ink-3);
          gap: 12px;
        "
      >
        <AppIcon name="refresh" :size="22" />
        <span class="mono" style="font-size: 13px">loading record…</span>
      </div>

      <AppAlert
        v-else-if="loadError"
        tone="err"
        title="Failed to load record"
        :closeable="false"
      >
        {{ loadError }}
      </AppAlert>

      <template v-else-if="record">
        <h3
          style="
            font-size: 18px;
            font-weight: 600;
            letter-spacing: -0.01em;
            margin-bottom: 14px;
          "
        >
          {{ record.attributes.title }}
        </h3>

        <div
          class="row wrap gap-3"
          style="align-items: center; margin-bottom: 18px"
        >
          <span class="row gap-2">
            <AppIcon
              :name="sourceTypeIcon(record.attributes.sourceType)"
              :size="15"
              :style="{ color: 'var(--accent)', flex: 'none' }"
            />
            <span class="mono" style="font-size: 12px; color: var(--ink-2)">
              {{
                formatSourceLabel(
                  record.attributes.source,
                  record.attributes.sourceType,
                )
              }}
            </span>
          </span>
          <AppBadge :tone="STATUS_TONE_MAP[record.attributes.status] ?? ''" dot>
            {{ record.attributes.status }}
          </AppBadge>
          <span class="mono faint" style="font-size: 12px">
            {{ formatRelativeTime(record.attributes.createdAt) }}
          </span>
        </div>

        <dl class="detail-grid" style="margin-bottom: 18px">
          <dt class="kicker">file</dt>
          <dd
            class="mono"
            :style="{
              fontSize: '12px',
              color: record.attributes.filePath
                ? 'var(--info)'
                : 'var(--ink-3)',
              wordBreak: 'break-all',
            }"
          >
            {{ record.attributes.filePath ?? "—" }}
          </dd>

          <dt class="kicker">uuid</dt>
          <dd class="mono" style="font-size: 12px; word-break: break-all">
            {{ record.attributes.uuid }}
          </dd>
        </dl>

        <AppAlert
          v-if="isErrorRecord"
          tone="err"
          title="Sync error"
          :closeable="false"
          style="margin-bottom: 18px"
        >
          <div class="col gap-2">
            <span>{{ errorMessageDisplay }}</span>
            <span
              v-if="retryError"
              data-testid="retry-error"
              class="mono"
              style="font-size: 12px; color: var(--err)"
              >{{ retryError }}</span
            >
            <AppBtn
              variant="ghost"
              size="sm"
              icon="refresh"
              :disabled="isRetryButtonDisabled"
              style="align-self: flex-start"
              @click="handleRetryClick"
              >{{ retryButtonLabel }}</AppBtn
            >
          </div>
        </AppAlert>

        <span class="kicker">content</span>
        <AppCodeBlock lang="markdown" :copy="record.attributes.content">{{
          record.attributes.content
        }}</AppCodeBlock>
      </template>
    </div>
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

const props = withDefaults(
  defineProps<{
    record: RecordResource | null;
    isLoading: boolean;
    loadError: string | null;
    // Swaps the button's label to "retrying…" while a retry request for this
    // specific record is in flight.
    isRetrying?: boolean;
    // Disables the retry button for a reason unrelated to isRetrying — the
    // caller sets this while some other bulk action is in flight, since
    // firing a second status-changing request concurrently would race it.
    isRetryDisabled?: boolean;
    // Set by the caller when the most recent retry attempt for this record
    // failed, so the modal can show it inline instead of relying on a
    // page-level alert hidden behind the modal's own backdrop.
    retryError?: string | null;
  }>(),
  {
    isRetrying: false,
    isRetryDisabled: false,
    retryError: null,
  },
);

const emit = defineEmits<{
  close: [];
  retry: [uuid: string];
}>();

const NO_ERROR_DETAILS_MESSAGE = "No error details available.";

const isErrorRecord = computed(
  () => props.record?.attributes.status === "error",
);

const errorMessageDisplay = computed(
  () => props.record?.attributes.errorMessage || NO_ERROR_DETAILS_MESSAGE,
);

const retryButtonLabel = computed(() =>
  props.isRetrying ? "retrying…" : "retry sync",
);

const isRetryButtonDisabled = computed(
  () => props.isRetrying || props.isRetryDisabled,
);

function handleRetryClick(): void {
  if (!props.record) {
    return;
  }
  emit("retry", props.record.attributes.uuid);
}

const cardElement = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

// A successful retry flips the record out of error status, which unmounts
// the AppAlert holding the button the user just focused — dropping focus to
// <body>, outside the dialog. Return it to the card (already tabindex="-1")
// so keyboard users aren't dropped out of the modal.
watch(isErrorRecord, (isError, wasError) => {
  if (!isError && wasError) {
    cardElement.value?.focus();
  }
});

// Only dismiss when both the press and the release land on the backdrop, so a
// text selection dragged between the card and the overlay in either direction
// doesn't close the modal mid-copy.
let mousedownOnBackdrop = false;
let mouseupOnBackdrop = false;

function handleBackdropMousedown(event: MouseEvent): void {
  mousedownOnBackdrop = event.target === event.currentTarget;
}

function handleBackdropMouseup(event: MouseEvent): void {
  mouseupOnBackdrop = event.target === event.currentTarget;
}

function handleBackdropClick(): void {
  if (!mousedownOnBackdrop || !mouseupOnBackdrop) {
    return;
  }
  emit("close");
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    return;
  }
  emit("close");
}

onMounted(() => {
  previouslyFocused = document.activeElement as HTMLElement | null;
  cardElement.value?.focus();
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
  previouslyFocused?.focus();
});
</script>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: 60px 1fr;
  gap: 8px 16px;
  align-items: baseline;
}
</style>
