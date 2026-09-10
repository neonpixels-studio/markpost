<template>
  <TheAppShell active="inbox" crumb="WORKSPACE / DAN'S VAULT" title="Inbox">
    <template #actions>
      <AppBtn
        variant="accent"
        size="sm"
        icon="refresh"
        :disabled="isSyncing"
        @click="syncNow"
        >sync now</AppBtn
      >
      <AppBtn
        size="sm"
        :icon="isExporting ? 'refresh' : 'download'"
        :disabled="isLoading || !!loadError || isExporting"
        @click="exportRecords"
        >{{ isExporting ? "exporting…" : "export all records" }}</AppBtn
      >
    </template>

    <div style="padding: 22px 26px 40px; max-width: 1080px">
      <div v-if="showToast" style="margin-bottom: 18px">
        <AppAlert
          tone="ok"
          title="Sync complete"
          :closeable="true"
          @close="showToast = false"
        >
          Records refreshed successfully.
        </AppAlert>
      </div>

      <div v-if="exportNotice" style="margin-bottom: 18px">
        <AppAlert
          :tone="exportNotice.tone"
          :title="exportNotice.title"
          :closeable="true"
          @close="exportNotice = null"
        >
          {{ exportNotice.message }}
        </AppAlert>
      </div>

      <AppAlert
        v-if="syncError"
        tone="err"
        title="Sync failed"
        :closeable="true"
        style="margin-bottom: 18px"
        @close="syncError = null"
      >
        {{ syncError }}
      </AppAlert>

      <AppAlert
        v-if="actionError"
        tone="err"
        title="Action failed"
        :closeable="true"
        style="margin-bottom: 18px"
        @close="actionError = null"
      >
        {{ actionError }}
      </AppAlert>

      <!-- stat row -->
      <div
        style="
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin-bottom: 22px;
        "
      >
        <div
          v-for="stat in statsDisplay"
          :key="stat.k"
          class="card"
          style="padding: 16px"
        >
          <div class="row between">
            <span class="kicker">{{ stat.k }}</span>
            <AppIcon
              :name="stat.ic"
              :size="15"
              :style="{ color: stat.t ? `var(--${stat.t})` : 'var(--ink-3)' }"
            />
          </div>
          <div
            class="row"
            style="align-items: baseline; gap: 4px; margin-top: 10px"
          >
            <span
              style="font-size: 28px; font-weight: 600; letter-spacing: -0.02em"
              class="tnum"
            >
              {{ stat.v }}
            </span>
            <span v-if="stat.sub" class="mono faint" style="font-size: 12px">{{
              stat.sub
            }}</span>
          </div>
        </div>
      </div>

      <!-- filters -->
      <div class="row between wrap gap-3" style="margin-bottom: 14px">
        <InputSegmented v-model="filter" :options="RECORD_FILTER_OPTIONS" />
        <span class="mono faint" style="font-size: 12px"
          >{{ records.length }} records</span
        >
      </div>

      <!-- bulk action toolbar -->
      <RecordBulkActions
        v-if="selectedCount > 0"
        :selected-count="selectedCount"
        :disabled="isBulkActionInFlight"
        @mark-status="markSelectedStatus"
        @delete-selected="requestBulkDelete"
        @clear="clearSelection"
      />

      <!-- loading state -->
      <div
        v-if="isLoading"
        class="col"
        style="
          align-items: center;
          padding: 60px 0;
          color: var(--ink-3);
          gap: 12px;
        "
      >
        <AppIcon name="refresh" :size="24" />
        <span class="mono" style="font-size: 13px">loading records…</span>
      </div>

      <!-- load error state -->
      <AppAlert
        v-else-if="loadError"
        tone="err"
        title="Failed to load records"
        :closeable="false"
      >
        {{ loadError }}
      </AppAlert>

      <!-- table -->
      <template v-else>
        <!-- empty state -->
        <div
          v-if="records.length === 0"
          class="col"
          style="
            align-items: center;
            padding: 60px 0;
            color: var(--ink-3);
            gap: 12px;
            text-align: center;
          "
        >
          <AppIcon name="inbox" :size="32" />
          <span
            style="font-size: 15px; font-weight: 500; color: var(--ink-2)"
            >{{ emptyStateTitle }}</span
          >
          <span class="mono" style="font-size: 13px">
            {{ emptyStateHint }}
          </span>
        </div>

        <template v-else>
          <div class="card" style="overflow: hidden">
            <div
              class="row"
              style="
                padding: 10px 18px;
                border-bottom: 1px solid var(--line);
                background: var(--bg-2);
                font-family: var(--mono);
                font-size: 10.5px;
                letter-spacing: 0.1em;
                text-transform: uppercase;
                color: var(--ink-3);
              "
            >
              <span style="width: 28px">
                <InputCheckbox
                  :model-value="isAllVisibleSelected"
                  :aria-label="selectAllLabel"
                  @update:model-value="toggleSelectAllVisible"
                />
              </span>
              <span style="width: 120px">source</span>
              <span style="flex: 1">record</span>
              <span style="width: 230px">file</span>
              <span style="width: 90px">status</span>
              <span style="width: 80px; text-align: right">time</span>
              <span style="width: 44px"></span>
            </div>
            <div class="divide-y">
              <RecordRow
                v-for="record in records"
                :key="record.id"
                :record="record"
                :selected="isSelected(record.attributes.uuid)"
                :disabled="isBulkActionInFlight"
                @open="openRecord"
                @toggle-select="toggleSelection"
                @delete="requestSingleDelete"
              />
            </div>
          </div>

          <AppLoadMore
            v-if="hasMore"
            :is-loading="isLoadingMore"
            @load="loadMore"
          />
        </template>
      </template>
    </div>

    <RecordDetailModal
      v-if="activeRecordUuid"
      :record="detailRecord"
      :is-loading="isDetailLoading"
      :load-error="detailError"
      :is-retrying="isRetryingActiveRecord"
      :is-retry-disabled="isBulkActionInFlight"
      :retry-error="retryError"
      @close="closeRecordDetail"
      @retry="retryRecord"
    />

    <ConfirmDialog
      v-if="pendingDeleteUuids"
      :title="deleteConfirmTitle"
      :message="deleteConfirmMessage"
      confirm-label="delete"
      :disabled="isBulkActionInFlight"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </TheAppShell>
</template>

<script setup lang="ts">
import {
  useRecords,
  fetchRecordStats,
  triggerRecordExportDownload,
  RECORD_FILTER_OPTIONS,
  BULK_ACTION_MAX_BATCH_SIZE,
  type RecordStats,
  type RecordStatus,
} from "~/composables/useRecords";
import { useRecordDetail } from "~/composables/useRecordDetail";
import { useExportNotice } from "~/composables/useExportNotice";

definePageMeta({ middleware: "auth" });

useHead({ title: "Inbox" });

const INBOX_PATH = "/inbox";
const RECORD_QUERY_KEY = "record";

const {
  records,
  isLoading,
  isLoadingMore,
  loadError,
  hasMore,
  filter,
  loadRecords,
  loadMore,
  selectedUuids,
  selectedCount,
  isSelected,
  toggleSelection,
  isAllVisibleSelected,
  toggleSelectAllVisible,
  clearSelection,
  isDeleting,
  isUpdatingStatus,
  actionError,
  deleteRecords,
  updateRecordsStatus,
} = useRecords("all");

const isBulkActionInFlight = computed(
  () => isDeleting.value || isUpdatingStatus.value,
);

// State-aware label: static text like "Select up to N records" reads wrong
// once fewer than N records are loaded, and stops making sense entirely once
// everything is already selected and the control's actual behavior is to
// deselect.
const selectAllLabel = computed(() => {
  if (isAllVisibleSelected.value) {
    return "Deselect all records";
  }

  const selectableCount = Math.min(
    records.value.length,
    BULK_ACTION_MAX_BATCH_SIZE,
  );
  const recordWord = selectableCount === 1 ? "record" : "records";
  return `Select ${selectableCount} ${recordWord}`;
});

const pendingDeleteUuids = ref<string[] | null>(null);

const deleteConfirmTitle = computed(() => {
  const count = pendingDeleteUuids.value?.length ?? 0;
  return count === 1 ? "Delete record?" : `Delete ${count} records?`;
});

const deleteConfirmMessage = computed(() => {
  const count = pendingDeleteUuids.value?.length ?? 0;
  return count === 1
    ? "This will permanently delete this record. This cannot be undone."
    : `This will permanently delete ${count} selected records. This cannot be undone.`;
});

function requestSingleDelete(uuid: string): void {
  pendingDeleteUuids.value = [uuid];
}

function requestBulkDelete(): void {
  if (selectedUuids.value.size === 0) {
    return;
  }
  pendingDeleteUuids.value = [...selectedUuids.value];
}

function cancelDelete(): void {
  pendingDeleteUuids.value = null;
}

async function confirmDelete(): Promise<void> {
  if (!pendingDeleteUuids.value || isBulkActionInFlight.value) {
    return;
  }

  const uuids = pendingDeleteUuids.value;
  pendingDeleteUuids.value = null;
  await deleteRecords(uuids);
  // The stat cards (synced/pending/errors/this month) reflect status counts
  // that a delete can change — refresh them so they don't go stale until the
  // next full reload.
  await refreshStats();
}

async function markSelectedStatus(status: RecordStatus): Promise<void> {
  if (selectedUuids.value.size === 0 || isBulkActionInFlight.value) {
    return;
  }
  await updateRecordsStatus([...selectedUuids.value], status);
  // Same reasoning as confirmDelete: a status change can move records between
  // the synced/pending/errors buckets the stat cards show.
  await refreshStats();
}

const emptyStateTitle = computed(() => {
  if (filter.value === "all") {
    return "No records yet";
  }

  return `No ${filter.value} records`;
});

const emptyStateHint = computed(() => {
  if (filter.value === "all") {
    return "Records will appear here once a source delivers them.";
  }

  return "Try a different filter.";
});

const showToast = ref(false);
const syncError = ref<string | null>(null);

const {
  notice: exportNotice,
  isExporting,
  run: exportRecords,
} = useExportNotice(triggerRecordExportDownload);
const isSyncing = ref(false);
const stats = ref<RecordStats | null>(null);

const statsDisplay = computed(() => [
  {
    k: "synced today",
    v: stats.value !== null ? String(stats.value.syncedToday) : "—",
    ic: "checkCircle",
    t: "ok",
    sub: null,
  },
  {
    k: "pending",
    v: stats.value !== null ? String(stats.value.pending) : "—",
    ic: "clock",
    t: "warn",
    sub: null,
  },
  {
    k: "errors",
    v: stats.value !== null ? String(stats.value.errors) : "—",
    ic: "triangle",
    t: "err",
    sub: null,
  },
  {
    k: "this month",
    v: stats.value !== null ? String(stats.value.thisMonth) : "—",
    ic: "fileText",
    t: "",
    sub: "/ ∞",
  },
]);

async function refreshStats(): Promise<void> {
  const fetchedStats = await fetchRecordStats();
  if (fetchedStats !== null) {
    stats.value = fetchedStats;
  }
}

async function syncNow(): Promise<void> {
  isSyncing.value = true;
  syncError.value = null;
  showToast.value = false;

  try {
    await Promise.all([loadRecords(), refreshStats()]);

    if (loadError.value) {
      syncError.value = "Sync failed. Please try again.";
    } else {
      showToast.value = true;
    }
  } finally {
    isSyncing.value = false;
  }
}

const route = useRoute();
const {
  record: detailRecord,
  isLoading: isDetailLoading,
  loadError: detailError,
  open: openDetail,
  close: closeDetail,
  applyUpdate: applyDetailUpdate,
} = useRecordDetail();

const activeRecordUuid = computed(() => {
  const value = route.query[RECORD_QUERY_KEY];
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
});

// The modal's retry button needs its own "in flight" and "failed" state
// rather than reusing isBulkActionInFlight/actionError directly: the modal
// covers the whole viewport while open, but a bulk action started just
// before it opened (e.g. select rows, click "mark synced", then open a
// different record before that resolves) can still be in flight, and would
// otherwise mislabel the button "retrying…" for a retry that never started.
const retryingUuid = ref<string | null>(null);
const retryError = ref<string | null>(null);

const isRetryingActiveRecord = computed(
  () =>
    retryingUuid.value !== null &&
    retryingUuid.value === activeRecordUuid.value,
);

function openRecord(uuid: string): void {
  void navigateTo({
    path: INBOX_PATH,
    query: { ...route.query, [RECORD_QUERY_KEY]: uuid },
  });
}

function closeRecordDetail(): void {
  const query = { ...route.query };
  delete query[RECORD_QUERY_KEY];
  // Replace so pressing Back after closing doesn't reopen the modal.
  void navigateTo({ path: INBOX_PATH, query }, { replace: true });
}

const RETRY_FAILED_MESSAGE = "Failed to retry record. Please try again.";

// Isolates the request + its follow-up from retryRecord's flag bookkeeping
// below, and keeps retryRecord itself from mixing three concerns (guard,
// in-flight state, request handling) in one function.
async function markRecordPendingForRetry(uuid: string): Promise<void> {
  const [updated] = await updateRecordsStatus([uuid], "pending");

  // The user may have navigated to a different record while this request was
  // in flight — only the still-open record's uuid should be allowed to set
  // retryError or push a detail update; a stale response for a record that's
  // no longer open must not surface on whatever is open now.
  if (activeRecordUuid.value !== uuid) {
    return;
  }

  if (!updated) {
    retryError.value = actionError.value ?? RETRY_FAILED_MESSAGE;
    return;
  }

  applyDetailUpdate(updated);
  await refreshStats();
}

// Reuses the same bulk status-update path as the toolbar's "mark pending" so
// a stuck error record moves out of the error bucket the next CLI sync
// retries it: updateRecordsStatus updates the table row, applyDetailUpdate
// pushes the fresh record into the modal, and refreshStats updates the stat
// cards.
async function retryRecord(uuid: string): Promise<void> {
  if (isBulkActionInFlight.value) {
    return;
  }

  retryError.value = null;
  retryingUuid.value = uuid;

  try {
    await markRecordPendingForRetry(uuid);
  } finally {
    retryingUuid.value = null;
  }
}

watch(
  activeRecordUuid,
  (uuid) => {
    retryError.value = null;
    if (!uuid) {
      closeDetail();
      return;
    }
    void openDetail(uuid);
  },
  { immediate: true },
);

onMounted(async () => {
  await Promise.all([loadRecords(), refreshStats()]);
});
</script>
