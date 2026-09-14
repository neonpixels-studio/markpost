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
        <AppBtn variant="ghost" size="sm" icon="x" @click="requestClose"
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

      <template v-else-if="displayedRecord">
        <RecordTitleField
          v-model="editTitleValue"
          :title="displayedRecord.attributes.title"
          :is-editing="isEditing"
          :disabled="isSaving"
          :title-error="titleError"
          @edit="startEdit"
        />

        <div
          class="row wrap gap-3"
          style="align-items: center; margin-bottom: 18px"
        >
          <span class="row gap-2">
            <AppIcon
              :name="sourceTypeIcon(displayedRecord.attributes.sourceType)"
              :size="15"
              :style="{ color: 'var(--accent)', flex: 'none' }"
            />
            <span class="mono" style="font-size: 12px; color: var(--ink-2)">
              {{
                formatSourceLabel(
                  displayedRecord.attributes.source,
                  displayedRecord.attributes.sourceType,
                )
              }}
            </span>
          </span>
          <AppBadge
            :tone="STATUS_TONE_MAP[displayedRecord.attributes.status] ?? ''"
            dot
          >
            {{ displayedRecord.attributes.status }}
          </AppBadge>
          <span class="mono faint" style="font-size: 12px">
            {{ formatRelativeTime(displayedRecord.attributes.createdAt) }}
          </span>
        </div>

        <dl class="detail-grid" style="margin-bottom: 18px">
          <dt class="kicker">file</dt>
          <dd
            class="mono"
            :style="{
              fontSize: '12px',
              color: displayedRecord.attributes.filePath
                ? 'var(--info)'
                : 'var(--ink-3)',
              wordBreak: 'break-all',
            }"
          >
            {{ displayedRecord.attributes.filePath ?? "—" }}
          </dd>

          <dt class="kicker">uuid</dt>
          <dd class="mono" style="font-size: 12px; word-break: break-all">
            {{ displayedRecord.attributes.uuid }}
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

        <RecordContentField
          v-model="editContentValue"
          :content="displayedRecord.attributes.content"
          :is-editing="isEditing"
          :is-saving="isSaving"
          :can-save="isTitleValid"
          :save-error="saveError"
          @save="handleSave"
          @cancel="cancelEdit"
        />
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
import { updateRecordContent } from "~/composables/useRecordEdit";
import { extractErrorDetail } from "~/utils/apiError";

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
  // Fired after a successful title/content save so a parent that keeps its
  // own copy of this record (e.g. the inbox table row) can refresh it. This
  // component never mutates the caller's record itself — see
  // editedRecordOverride below for how it stays current without that.
  updated: [record: RecordResource];
}>();

const NO_ERROR_DETAILS_MESSAGE = "No error details available.";

// Holds the server's response right after a successful save so the modal
// reflects the edit immediately without waiting for the parent to push a
// fresh `record` prop (which — unlike a retry — nothing here requires the
// parent to do). Cleared whenever a new record starts loading; see the
// isLoading watcher below.
const editedRecordOverride = ref<RecordResource | null>(null);

const displayedRecord = computed(
  () => editedRecordOverride.value ?? props.record,
);

const isErrorRecord = computed(
  () => displayedRecord.value?.attributes.status === "error",
);

const errorMessageDisplay = computed(
  () =>
    displayedRecord.value?.attributes.errorMessage || NO_ERROR_DETAILS_MESSAGE,
);

const retryButtonLabel = computed(() =>
  props.isRetrying ? "retrying…" : "retry sync",
);

const isRetryButtonDisabled = computed(
  () => props.isRetrying || props.isRetryDisabled,
);

function handleRetryClick(): void {
  if (!displayedRecord.value) {
    return;
  }
  emit("retry", displayedRecord.value.attributes.uuid);
}

const isEditing = ref(false);
const editTitleValue = ref("");
const editContentValue = ref("");
const isSaving = ref(false);
const saveError = ref<string | null>(null);

const isTitleValid = computed(() => editTitleValue.value.trim().length > 0);

// Only surfaced once the field has actually been touched (isEditing true) —
// showing "title is required" the instant the modal opens, before the user
// has typed anything, would read as a pre-existing error rather than
// validation of their edit.
const titleError = computed(() => {
  if (!isEditing.value || isTitleValid.value) {
    return null;
  }
  return "Title can't be empty.";
});

function resetEditState(): void {
  isEditing.value = false;
  editedRecordOverride.value = null;
  saveError.value = null;
  isSaving.value = false;
}

// Keyed on the record's own identity, not on isLoading: a parent switching
// the open record while the modal stays mounted (clicking a different row
// without closing first) always goes through a uuid change (via a null
// intermediate while the new one loads, per useRecordDetail's open()) —
// checking the uuid directly discards an in-progress edit whenever the
// record it belongs to is no longer the one open, including a future caller
// that swaps `record` without also toggling `isLoading`. A same-record
// update from elsewhere (e.g. retryRecord's applyDetailUpdate) keeps the
// uuid unchanged, so an in-progress edit is left alone rather than
// discarded out from under the user.
watch(
  () => props.record?.attributes.uuid,
  (uuid, previousUuid) => {
    if (uuid !== previousUuid) {
      resetEditState();
    }
  },
);

// Once the parent pushes any fresher copy of this same record (e.g. a retry
// that only touched status/errorMessage), that copy is authoritative — it
// was read from the database after our own save already landed there, so it
// already carries the edited title/content and the override can be dropped
// rather than going on shadowing status/errorMessage changes forever.
watch(
  () => props.record,
  () => {
    editedRecordOverride.value = null;
  },
);

function startEdit(): void {
  if (!displayedRecord.value) {
    return;
  }
  editTitleValue.value = displayedRecord.value.attributes.title;
  editContentValue.value = displayedRecord.value.attributes.content;
  saveError.value = null;
  isEditing.value = true;
}

function cancelEdit(): void {
  isEditing.value = false;
  saveError.value = null;
}

const SAVE_FAILED_MESSAGE = "Failed to save changes. Please try again.";

// True once the parent has moved on from the record this save request was
// issued for (switched to a different one, or closed the modal) — a resolved
// or rejected response arriving after that point must not touch this
// instance's state at all, since the user is no longer looking at that
// record and a same-uuid record open elsewhere would wrongly inherit it.
function isStillEditing(uuid: string): boolean {
  return props.record?.attributes.uuid === uuid;
}

async function handleSave(): Promise<void> {
  if (!displayedRecord.value || !isTitleValid.value || isSaving.value) {
    return;
  }

  const editedUuid = displayedRecord.value.attributes.uuid;
  isSaving.value = true;
  saveError.value = null;

  try {
    const updated = await updateRecordContent(editedUuid, {
      title: editTitleValue.value.trim(),
      content: editContentValue.value,
    });

    if (!isStillEditing(editedUuid)) {
      return;
    }

    editedRecordOverride.value = updated;
    isEditing.value = false;
    emit("updated", updated);
  } catch (error) {
    if (!isStillEditing(editedUuid)) {
      return;
    }
    saveError.value = extractErrorDetail(error, SAVE_FAILED_MESSAGE);
  } finally {
    // Unconditional, unlike the record-mutating effects above: a stale
    // response's `isSaving` write is always safe to apply (either the
    // record switch already reset it to false via resetEditState below, or
    // this instance is still editing the same record and genuinely needs it
    // cleared) — guarding it too would risk leaving the save button stuck
    // disabled if a future caller ever updates `record` without going
    // through resetEditState.
    isSaving.value = false;
  }
}

const cardElement = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

// Several distinct browser behaviors can drop focus to <body>, outside the
// dialog: a successful retry unmounts the AppAlert (and the button inside
// it) once the record leaves error status; disabling a focused button
// (isRetryButtonDisabled going true, e.g. while the request is in flight)
// triggers the browser's own focus-fixup — which also fires on a *failed*
// retry, since the button was disabled and re-enabled without ever being
// refocused; and leaving edit mode (Save or Cancel) unmounts whichever of
// those two buttons was focused. isEditing going true is handled inside
// RecordTitleField itself (it moves focus into the input that replaces the
// edit button), so it's not listed here — only the exit direction needs this
// fallback. Re-checking `document.activeElement` rather than reacting
// unconditionally means this only reclaims focus that was actually lost
// here, not focus the user deliberately moved elsewhere (e.g. tabbed to
// "close") in the meantime.
watch(
  [isErrorRecord, isRetryButtonDisabled, isEditing],
  () => {
    if (document.activeElement !== document.body) {
      return;
    }
    cardElement.value?.focus();
  },
  { flush: "post" },
);

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

// The one path every "close" trigger (header button, backdrop click,
// Escape) funnels through, so a mid-edit draft can never be silently
// destroyed by any of them — the modal stays open and the user has to
// explicitly cancel or save first.
function requestClose(): void {
  if (isEditing.value) {
    return;
  }
  emit("close");
}

function handleBackdropClick(): void {
  if (!mousedownOnBackdrop || !mouseupOnBackdrop) {
    return;
  }
  requestClose();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    return;
  }
  // Escape backs out one level rather than doing nothing while editing:
  // it cancels the in-progress edit (same as the Cancel button) instead of
  // closing the whole modal out from under a draft.
  if (isEditing.value) {
    cancelEdit();
    return;
  }
  requestClose();
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
