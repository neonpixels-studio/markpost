import {
  SOURCE_TYPES,
  isSourceType,
  type SourceType,
} from "#shared/utils/sourceTypes";
import { computeElapsedBuckets } from "../utils/timeBuckets";
import { downloadExport, type ExportOutcome } from "../utils/exportDownload";
import { RECORDS_EXPORT_FILENAME } from "#shared/utils/export";
import {
  RECORD_STATUSES,
  MAX_DELETE_BATCH_SIZE,
  MAX_UPDATE_BATCH_SIZE,
  type RecordStatus,
} from "#shared/utils/records";

export type { RecordStatus };

// Re-exported under its existing name (consumers: RecordBulkActions.vue) —
// #shared/utils/records is the source of truth so client validation can
// never drift from server/db/schema.ts.
export const RECORD_STATUS_VALUES: readonly RecordStatus[] = RECORD_STATUSES;

export type RecordAttributes = {
  uuid: string;
  createdAt: string;
  userId: string;
  title: string;
  content: string;
  sourceId: string | null;
  source: string | null;
  // Free text on the server (sources.type has no CHECK constraint), so the
  // contract is `string | null`, not `SourceType | null` — a legacy value
  // outside SOURCE_TYPES can arrive. Consumers (sourceTypeIcon) narrow with
  // isSourceType at the point of use.
  sourceType: string | null;
  status: RecordStatus;
  filePath: string | null;
  tags: unknown;
  frontmatter: unknown;
  syncedAt: string | null;
  errorMessage: string | null;
};

export type RecordResource = {
  type: "records";
  id: string;
  attributes: RecordAttributes;
  links: { self: string };
};

export type RecordStats = {
  syncedToday: number;
  pending: number;
  errors: number;
  thisMonth: number;
};

type RecordListResponse = {
  data: RecordResource[];
  meta?: {
    total?: number;
    size?: number;
    hasMore?: boolean;
  };
};

type StatsResponse = {
  data: RecordStats;
};

const RECORDS_EXPORT_URL = "/api/records/export";

export function triggerRecordExportDownload(): Promise<ExportOutcome> {
  return downloadExport(RECORDS_EXPORT_URL, RECORDS_EXPORT_FILENAME);
}

export type RecordFilterValue = "all" | "errors" | SourceType;

type FilterOption = {
  readonly value: RecordFilterValue;
  readonly label: string;
};

// Driven from the shared SOURCE_TYPES contract so every type the API filters on
// is reachable in the UI and the two lists can never drift apart. Labels mirror
// the raw type value (no pluralization) to keep this list the single source of
// truth — no second hand-maintained label map to drift.
export const RECORD_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: "all", label: "all" },
  ...SOURCE_TYPES.map((sourceType) => ({
    value: sourceType,
    label: sourceType,
  })),
  { value: "errors", label: "errors" },
];

type FetchFilters = {
  source?: string;
  status?: string;
};

function buildQueryParams(filter: RecordFilterValue): FetchFilters {
  if (filter === "errors") {
    return { status: "error" };
  }

  if (isSourceType(filter)) {
    return { source: filter };
  }

  if (filter !== "all") {
    console.error("[useRecords] unknown filter, showing all records:", filter);
  }

  return {};
}

// The "errors" filter is the only one status can invalidate — source filters
// and "all" never depend on status, so every record still belongs once its
// uuid survives the update.
function matchesActiveFilter(
  record: RecordResource,
  activeFilter: RecordFilterValue,
): boolean {
  if (activeFilter === "errors") {
    return record.attributes.status === "error";
  }

  return true;
}

export function buildFetchUrl(
  filter: RecordFilterValue,
  afterUuid?: string,
): string {
  const filters = buildQueryParams(filter);
  const params = new URLSearchParams();

  if (filters.source) {
    params.set("filter[source]", filters.source);
  }

  if (filters.status) {
    params.set("filter[status]", filters.status);
  }

  // The server-provided links.next drops the active filters, so we rebuild the
  // cursor URL client-side to keep filter[source]/filter[status] on later pages.
  if (afterUuid) {
    params.set("page[after]", afterUuid);
  }

  const queryString = params.toString();
  return queryString ? `/api/records?${queryString}` : "/api/records";
}

type RecordPage = {
  records: RecordResource[];
  hasMore: boolean;
};

async function fetchRecordList(
  filter: RecordFilterValue,
  afterUuid?: string,
): Promise<RecordPage> {
  const url = buildFetchUrl(filter, afterUuid);
  const response = await $fetch<RecordListResponse>(url);
  return {
    records: response.data ?? [],
    hasMore: response.meta?.hasMore ?? false,
  };
}

// Both the delete and bulk-update endpoints reject a batch larger than their
// own cap (see #shared/utils/records); the UI enforces the smaller of the two
// so a selection is never accepted here only to be rejected once the request
// round-trips to the server. Today both caps are 100, so this is 100, but the
// derivation stays correct if the endpoints' caps ever diverge.
export const BULK_ACTION_MAX_BATCH_SIZE = Math.min(
  MAX_DELETE_BATCH_SIZE,
  MAX_UPDATE_BATCH_SIZE,
);

const BULK_ACTION_CAP_MESSAGE = `You can act on at most ${BULK_ACTION_MAX_BATCH_SIZE} records at a time.`;
const BULK_SELECTION_CAP_MESSAGE = `You can select at most ${BULK_ACTION_MAX_BATCH_SIZE} records at a time.`;

type DeleteRecordsResponse = {
  meta: { deleted: number };
};

async function deleteRecordsRequest(uuids: string[]): Promise<number> {
  const response = await $fetch<DeleteRecordsResponse>("/api/records", {
    method: "DELETE",
    body: { data: { attributes: { uuids } } },
  });
  return response.meta.deleted;
}

type BulkStatusUpdate = {
  uuid: string;
  status: RecordStatus;
  errorMessage?: null;
};

async function updateRecordsStatusRequest(
  updates: BulkStatusUpdate[],
): Promise<RecordResource[]> {
  const response = await $fetch<RecordListResponse>("/api/records", {
    method: "PATCH",
    body: { data: { attributes: { records: updates } } },
  });
  return response.data ?? [];
}

// The browser's IANA time zone, so the server can bucket "synced today" and
// "this month" by the user's local midnight instead of UTC. Returns undefined
// when unavailable (e.g. during SSR the server resolves to its own zone), which
// the stats endpoint treats as UTC.
function resolveBrowserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function buildStatsUrl(): string {
  const timeZone = resolveBrowserTimeZone();
  if (!timeZone) {
    return "/api/records/stats";
  }

  const params = new URLSearchParams({ tz: timeZone });
  return `/api/records/stats?${params.toString()}`;
}

export async function fetchRecordStats(): Promise<RecordStats | null> {
  try {
    const response = await $fetch<StatsResponse>(buildStatsUrl());
    return response.data;
  } catch (fetchError) {
    console.error("[useRecords] fetchRecordStats error:", fetchError);
    return null;
  }
}

export type BadgeTone = "" | "ok" | "warn" | "err" | "info" | "accent";

export const STATUS_TONE_MAP: Record<string, BadgeTone> = {
  synced: "ok",
  pending: "warn",
  error: "err",
};

const DEFAULT_SOURCE_ICON = "zap";
const UNKNOWN_SOURCE_LABEL = "unknown";

// Icon per canonical source type (`sources.type`). Record rows resolve their
// icon from the real type, not the free-text `source` display name (which never
// carried a reliable type prefix). Keyed by SourceType so the compiler flags a
// missing icon whenever a new source type is added to the shared contract.
const SOURCE_TYPE_ICONS: Record<SourceType, string> = {
  webhook: "zap",
  email: "mail",
  stripe: "card",
  github: "github",
  zapier: "zap",
  shortcuts: "plug",
};

export function sourceTypeIcon(sourceType: string | null): string {
  if (!sourceType || !isSourceType(sourceType)) {
    return DEFAULT_SOURCE_ICON;
  }

  return SOURCE_TYPE_ICONS[sourceType];
}

export function formatSourceLabel(
  source: string | null,
  sourceType: string | null,
): string {
  // Prefer the source's display name so two sources of the same type (e.g. two
  // webhooks, "Prod deploys" and "Staging deploys") stay distinguishable — the
  // real type is already conveyed by the icon. Fall back to the type name, then
  // to "unknown", when no name is stored.
  if (source) {
    return source;
  }

  // Show whatever type the server resolved, even a legacy value outside the
  // current SOURCE_TYPES set (sources.type is free text) — a real type name is
  // a better label than "unknown". The output is escaped by Vue, so it needs
  // no isSourceType guard here (the icon lookup still does).
  if (sourceType) {
    return sourceType;
  }

  return UNKNOWN_SOURCE_LABEL;
}

export function formatRelativeTime(isoString: string): string {
  const buckets = computeElapsedBuckets(isoString);

  if (!buckets) {
    return "—";
  }

  const { seconds, minutes, hours, days } = buckets;

  if (seconds < 60) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (hours < 24) {
    return `${hours}h ago`;
  }

  if (days === 1) {
    return "yesterday";
  }

  return `${days}d ago`;
}

export function useRecords(initialFilter: RecordFilterValue = "all") {
  const records = ref<RecordResource[]>([]);
  const isLoading = ref(false);
  const isLoadingMore = ref(false);
  const loadError = ref<string | null>(null);
  const hasMore = ref(false);
  const filter = ref<RecordFilterValue>(initialFilter);
  const selectedUuids = ref<Set<string>>(new Set());
  const isDeleting = ref(false);
  const isUpdatingStatus = ref(false);
  const actionError = ref<string | null>(null);

  const selectedCount = computed(() => selectedUuids.value.size);

  function isSelected(uuid: string): boolean {
    return selectedUuids.value.has(uuid);
  }

  // The only assignment path that also clears actionError — every successful
  // selection change (toggleSelection mutates a working copy first, but still
  // lands here) runs through this, so the cap message in particular can never
  // linger once the selection is legal again. deselectUuids and
  // pruneSelection below assign selectedUuids directly instead of routing
  // through here precisely because they must not clear actionError (they run
  // right after a bulk action sets it).
  function setSelection(uuids: Iterable<string>): void {
    selectedUuids.value = new Set(uuids);
    actionError.value = null;
  }

  // Mirrors the server's own MAX_*_BATCH_SIZE cap: once a selection is already
  // at the limit, a further add is rejected with a visible message rather than
  // silently discarding the click (fail loud, not quiet).
  function toggleSelection(uuid: string): void {
    const next = new Set(selectedUuids.value);

    if (next.has(uuid)) {
      next.delete(uuid);
      setSelection(next);
      return;
    }

    if (next.size >= BULK_ACTION_MAX_BATCH_SIZE) {
      actionError.value = BULK_SELECTION_CAP_MESSAGE;
      return;
    }

    next.add(uuid);
    setSelection(next);
  }

  function clearSelection(): void {
    setSelection([]);
  }

  // Removes only the given uuids from the selection, leaving the rest
  // selected — used after a partially-successful bulk action so the uuids
  // that failed stay selected for a retry instead of being dropped silently.
  function deselectUuids(uuidsToRemove: string[]): void {
    if (uuidsToRemove.length === 0) {
      return;
    }

    const removeSet = new Set(uuidsToRemove);
    selectedUuids.value = new Set(
      [...selectedUuids.value].filter((uuid) => !removeSet.has(uuid)),
    );
  }

  // "All visible" means every visible record up to the batch cap — with more
  // records loaded than the cap allows, toggleSelectAllVisible below can never
  // select every one of them, so basing this on the raw record count would
  // leave the header checkbox permanently unchecked and unable to clear.
  const isAllVisibleSelected = computed(() => {
    if (records.value.length === 0) {
      return false;
    }

    const cappedVisibleUuids = records.value
      .map((record) => record.attributes.uuid)
      .slice(0, BULK_ACTION_MAX_BATCH_SIZE);

    return cappedVisibleUuids.every((uuid) => isSelected(uuid));
  });

  // Selecting every visible record is capped the same way as a single toggle —
  // a page larger than the batch limit selects only its first
  // BULK_ACTION_MAX_BATCH_SIZE records rather than a set the server would
  // reject.
  function toggleSelectAllVisible(): void {
    if (isAllVisibleSelected.value) {
      clearSelection();
      return;
    }

    setSelection(
      records.value
        .map((record) => record.attributes.uuid)
        .slice(0, BULK_ACTION_MAX_BATCH_SIZE),
    );
  }

  // Selection only ever refers to uuids still visible in `records` — a filter
  // change, a reload, or a delete elsewhere should drop a uuid out of the
  // selection rather than leave it selected with no row to toggle it off.
  function pruneSelection(): void {
    if (selectedUuids.value.size === 0) {
      return;
    }

    const visibleUuids = new Set(
      records.value.map((record) => record.attributes.uuid),
    );
    selectedUuids.value = new Set(
      [...selectedUuids.value].filter((uuid) => visibleUuids.has(uuid)),
    );
  }

  async function loadRecords(): Promise<void> {
    isLoading.value = true;
    loadError.value = null;

    try {
      const page = await fetchRecordList(filter.value);
      records.value = page.records;
      hasMore.value = page.hasMore;
      pruneSelection();
    } catch (fetchError) {
      console.error("[useRecords] loadRecords error:", fetchError);
      loadError.value = "Failed to load records. Please try again.";
    } finally {
      isLoading.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (isLoadingMore.value || !hasMore.value) {
      return;
    }

    const lastRecord = records.value.at(-1);
    if (!lastRecord) {
      return;
    }

    isLoadingMore.value = true;
    loadError.value = null;

    try {
      const page = await fetchRecordList(
        filter.value,
        lastRecord.attributes.uuid,
      );
      records.value = [...records.value, ...page.records];
      hasMore.value = page.hasMore;
      pruneSelection();
    } catch (fetchError) {
      console.error("[useRecords] loadMore error:", fetchError);
      loadError.value = "Failed to load more records. Please try again.";
    } finally {
      isLoadingMore.value = false;
    }
  }

  // The cap is enforced here too, not just in the selection helpers — a
  // future caller that builds its own uuid list (bypassing toggleSelection)
  // must not be able to send a batch the server would reject outright.
  // Returns true (and sets actionError) when the batch is oversized, so
  // callers can bail with a single guard clause.
  function rejectOversizedBatch(uuids: string[]): boolean {
    if (uuids.length <= BULK_ACTION_MAX_BATCH_SIZE) {
      return false;
    }

    actionError.value = BULK_ACTION_CAP_MESSAGE;
    return true;
  }

  // Guards against a second concurrent bulk action racing this one — both
  // isDeleting/isUpdatingStatus flip synchronously before their first await,
  // so a caller that doesn't separately track in-flight state (inbox.vue
  // currently does) still can't fire two overlapping requests against the
  // same selection. Sets actionError rather than failing silently — a caller
  // relying on this guard should see the same "didn't happen, here's why"
  // feedback as every other rejection in this file.
  function rejectConcurrentBulkAction(): boolean {
    if (!isDeleting.value && !isUpdatingStatus.value) {
      return false;
    }

    actionError.value = "Another bulk action is still running. Please wait.";
    return true;
  }

  // A bulk action can filter every remaining row out of the current page
  // (e.g. marking all loaded "errors" records synced) while more still exist
  // server-side. Left alone, the page renders its empty state — which also
  // hides the load-more control — even though hasMore is still true, and only
  // a manual reload would recover. Reload proactively instead.
  async function backfillIfEmptied(): Promise<void> {
    if (records.value.length === 0 && hasMore.value) {
      await loadRecords();
    }
  }

  async function deleteRecords(uuids: string[]): Promise<number> {
    if (uuids.length === 0) {
      return 0;
    }

    if (rejectConcurrentBulkAction()) {
      return 0;
    }

    if (rejectOversizedBatch(uuids)) {
      return 0;
    }

    isDeleting.value = true;
    actionError.value = null;

    try {
      const deletedCount = await deleteRecordsRequest(uuids);

      // The server only deletes uuids it both owns and still finds — a
      // mismatch means some requested records survived (already removed
      // elsewhere, a stale row). Reload from the server rather than trusting
      // the local list, and say so instead of silently hiding a record that
      // still exists.
      if (deletedCount < uuids.length) {
        actionError.value = `Deleted ${deletedCount} of ${uuids.length} records. Reloading the list.`;
        await loadRecords();
        return deletedCount;
      }

      const deletedUuids = new Set(uuids);
      records.value = records.value.filter(
        (record) => !deletedUuids.has(record.attributes.uuid),
      );
      pruneSelection();
      await backfillIfEmptied();
      return deletedCount;
    } catch (deleteRequestError) {
      console.error("[useRecords] deleteRecords error:", deleteRequestError);
      actionError.value = "Failed to delete records. Please try again.";
      return 0;
    } finally {
      isDeleting.value = false;
    }
  }

  // Replaces each updated record in place, then drops any that no longer
  // belong under the active filter (e.g. marking an "errors"-filtered record
  // as synced) instead of leaving a stale row with a mismatched status.
  function applyStatusUpdates(updatedRecords: RecordResource[]): void {
    const updatedByUuid = new Map(
      updatedRecords.map((record) => [record.attributes.uuid, record]),
    );

    records.value = records.value
      .map((record) => updatedByUuid.get(record.attributes.uuid) ?? record)
      .filter((record) => matchesActiveFilter(record, filter.value));
  }

  async function updateRecordsStatus(
    uuids: string[],
    status: RecordStatus,
  ): Promise<RecordResource[]> {
    if (uuids.length === 0) {
      return [];
    }

    if (rejectConcurrentBulkAction()) {
      return [];
    }

    if (rejectOversizedBatch(uuids)) {
      return [];
    }

    isUpdatingStatus.value = true;
    actionError.value = null;

    try {
      // The server only writes fields present in the payload — moving a
      // record to "synced" or "pending" without also clearing errorMessage
      // would leave a stale failure reason on a record the UI now shows as
      // healthy or not-yet-attempted. Only "error" itself should keep it.
      const updates: BulkStatusUpdate[] = uuids.map((uuid) => ({
        uuid,
        status,
        ...(status === "error" ? {} : { errorMessage: null }),
      }));
      const updatedRecords = await updateRecordsStatusRequest(updates);
      applyStatusUpdates(updatedRecords);
      await backfillIfEmptied();

      // Only deselect the uuids the server actually updated — unlike delete,
      // an updated record can still be visible (e.g. filter "all"), so a
      // uuid the server skipped must stay selected for a retry rather than
      // being dropped as if it had succeeded.
      const updatedUuids = new Set(
        updatedRecords.map((record) => record.attributes.uuid),
      );
      deselectUuids(uuids.filter((uuid) => updatedUuids.has(uuid)));

      if (updatedRecords.length < uuids.length) {
        actionError.value = `Updated ${updatedRecords.length} of ${uuids.length} records. Please try again for the rest.`;
      }

      return updatedRecords;
    } catch (updateRequestError) {
      console.error(
        "[useRecords] updateRecordsStatus error:",
        updateRequestError,
      );
      actionError.value = "Failed to update records. Please try again.";
      return [];
    } finally {
      isUpdatingStatus.value = false;
    }
  }

  watch(filter, loadRecords);

  return {
    records,
    isLoading,
    isLoadingMore,
    loadError,
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
    hasMore,
    filter,
    loadRecords,
    loadMore,
  };
}
