import {
  SOURCE_TYPES,
  isSourceType,
  type SourceType,
} from "#shared/utils/sourceTypes";
import { computeElapsedBuckets } from "../utils/timeBuckets";
import { downloadExport, type ExportOutcome } from "../utils/exportDownload";
import { isNotFoundError } from "../utils/apiError";
import { fetchRecord } from "./useRecordDetail";
import { RECORDS_EXPORT_FILENAME } from "#shared/utils/export";
import {
  RECORD_STATUSES,
  MAX_DELETE_BATCH_SIZE,
  MAX_UPDATE_BATCH_SIZE,
  type RecordStatus,
} from "#shared/utils/records";

export type { RecordStatus };

// Re-exported from here (consumed by RecordBulkActions.vue) under this
// composable's own naming convention — #shared/utils/records is still the
// source of truth, so client validation can never drift from
// server/db/schema.ts.
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

  // Unlike GET /api/events, GET /api/records's server-provided links.next
  // drops the active filters, so we rebuild the cursor URL client-side to
  // keep filter[source]/filter[status] on later pages.
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
const RECONCILE_INCOMPLETE_MESSAGE_SUFFIX =
  " Some records could not be re-checked — refresh to confirm their status.";

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

// No syncedAt field: the server derives it (see server/api/records/index.patch.ts)
// rather than trusting a client-supplied value.
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

// The bulk PATCH endpoint applies each update with its own Promise.all (no
// transaction), so a mid-batch rejection can leave earlier rows already
// committed even though the request as a whole throws. Reconciling a failed
// batch needs "missing" (a real 404 — safe to drop locally) kept separate
// from "unknown" (the re-check itself failed some other way, e.g. the same
// outage that likely felled the PATCH) — collapsing the latter into the
// former would let a transient failure silently delete rows the server
// still has.
type RecordFetchOutcome =
  | { kind: "found"; record: RecordResource }
  | { kind: "missing" }
  | { kind: "unknown" };

async function fetchRecordOutcome(uuid: string): Promise<RecordFetchOutcome> {
  try {
    // fetchRecord (useRecordDetail.ts) can resolve `null` on a 200 with no
    // body; the real endpoint doesn't do this today (it 404s instead), but
    // that's not a guarantee to lean on here — treat it as unknown, not as
    // confirmation the row is gone.
    const record = await fetchRecord(uuid);
    if (!record) {
      console.error("[useRecords] unexpected empty record body:", uuid);
      return { kind: "unknown" };
    }

    return { kind: "found", record };
  } catch (fetchError) {
    if (isNotFoundError(fetchError)) {
      return { kind: "missing" };
    }

    console.error("[useRecords] fetchRecordOutcome error:", fetchError);
    return { kind: "unknown" };
  }
}

// Caps how many reconcile GETs run at once. This fires precisely when the
// server just failed a request, so fanning out one request per uuid (up to
// BULK_ACTION_MAX_BATCH_SIZE) would hit it with a retry storm at the worst
// possible time; a small worker pool bounds that without serializing the
// whole batch.
const RECONCILE_FETCH_CONCURRENCY = 5;

async function fetchRecordsByUuid(
  uuids: string[],
): Promise<Map<string, RecordFetchOutcome>> {
  const outcomesByUuid = new Map<string, RecordFetchOutcome>();
  const pendingUuids = [...uuids];

  async function runWorker(): Promise<void> {
    for (;;) {
      const nextUuid = pendingUuids.shift();
      if (nextUuid === undefined) {
        return;
      }

      outcomesByUuid.set(nextUuid, await fetchRecordOutcome(nextUuid));
    }
  }

  const workerCount = Math.min(RECONCILE_FETCH_CONCURRENCY, uuids.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));

  return outcomesByUuid;
}

type OutcomePartition = {
  foundRecords: RecordResource[];
  missingUuids: string[];
  uncheckedCount: number;
};

function partitionOutcomes(
  uuids: string[],
  outcomesByUuid: Map<string, RecordFetchOutcome>,
): OutcomePartition {
  const foundRecords: RecordResource[] = [];
  const missingUuids: string[] = [];
  let uncheckedCount = 0;

  uuids.forEach((uuid) => {
    const outcome = outcomesByUuid.get(uuid);

    if (outcome?.kind === "found") {
      foundRecords.push(outcome.record);
      return;
    }

    if (outcome?.kind === "missing") {
      missingUuids.push(uuid);
      return;
    }

    uncheckedCount += 1;
  });

  return { foundRecords, missingUuids, uncheckedCount };
}

function buildPartialUpdateMessage(
  appliedCount: number,
  totalCount: number,
): string {
  return `Updated ${appliedCount} of ${totalCount} records. Please try again for the rest.`;
}

// Confirms a refetched record's state proves the requested write actually
// landed, not just that it happens to already look like the target state —
// those aren't the same thing. A record already "synced" from a prior sync
// has a non-null syncedAt too; only comparing against requestedSyncedAt (a
// timestamp taken client-side just before the request — the server now
// derives and stamps its own, later, value; see withServerDerivedSyncedAt in
// server/api/records/index.patch.ts, markpost#265) can tell "just synced by
// this batch" apart from "was already synced from before, this batch never
// landed" — which matters because the stats card keys off *when* syncedAt
// was set. The ">=" comparison below only needs that ordering, not an exact
// match, so it still holds with a server-derived timestamp.
function matchesRequestedUpdate(
  record: RecordResource,
  requestedStatus: RecordStatus,
  requestedSyncedAt: string | null,
): boolean {
  if (record.attributes.status !== requestedStatus) {
    return false;
  }

  if (requestedStatus === "synced") {
    return (
      record.attributes.syncedAt !== null &&
      requestedSyncedAt !== null &&
      new Date(record.attributes.syncedAt).getTime() >=
        new Date(requestedSyncedAt).getTime()
    );
  }

  if (record.attributes.syncedAt !== null) {
    return false;
  }

  // "error" is the one status the server doesn't clear errorMessage for.
  return requestedStatus === "error" || record.attributes.errorMessage === null;
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

  // Guarded here too, not just at the toolbar's disabled "clear" button and
  // the header checkbox's own disabled state (see toggleSelectAllVisible,
  // which also routes here): this is the backstop so nothing that reaches
  // clearSelection directly can wipe the selection out from under a
  // still-running bulk action, which would leave the uuids that action's own
  // partial-failure handling relies on (deselectUuids keeps the failed ones
  // selected for retry) cleared before that handling ever runs. Reuses
  // rejectConcurrentBulkAction rather than a silent no-op, matching this
  // file's fail-loud convention (see its own comment below).
  function clearSelection(): void {
    if (rejectConcurrentBulkAction()) {
      return;
    }
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

  // "All visible" means every visible record is selected — and only counts as
  // "all" when the cap didn't have to cut anything, i.e. every currently
  // loaded record fits within it. Once loadMore (or a single oversized page)
  // pushes the loaded count past the cap, a "select all" can only ever reach
  // the first BULK_ACTION_MAX_BATCH_SIZE of them, leaving later, visible rows
  // unselected — so this must report false from that point on, no matter how
  // many further pages get appended afterwards or whether the server still
  // has more (hasMore) or not. Reporting true there, even once, would be a
  // lie about rows the user can plainly see are unchecked.
  //
  // toggleSelectAllVisible below branches on this same flag (not a separate
  // "is the capped window full" check) so a click always matches what the
  // control displays: unchecked always means "try to select", checked always
  // means "clear". Once the loaded count has exceeded the cap this flag can
  // never go true again, so the header control alone can no longer clear an
  // already-maxed selection — the separate bulk-action "clear" control
  // (RecordBulkActions) still can. Wiring a true indeterminate visual state
  // would remove that gap but means changing InputCheckbox and inbox.vue,
  // out of scope here (see PR body).
  const isAllVisibleSelected = computed(() => {
    if (
      records.value.length === 0 ||
      records.value.length > BULK_ACTION_MAX_BATCH_SIZE
    ) {
      return false;
    }

    return records.value.every((record) => isSelected(record.attributes.uuid));
  });

  // Selecting every visible record is capped the same way as a single toggle —
  // a page larger than the batch limit selects only its first
  // BULK_ACTION_MAX_BATCH_SIZE records rather than a set the server would
  // reject. Unlike a single toggle, this truncation was never the user
  // clicking past a limit they could see coming, so it must say so rather
  // than silently selecting fewer records than "select all" implied.
  function toggleSelectAllVisible(): void {
    if (records.value.length === 0) {
      return;
    }

    // Guards both branches below, not just the clearSelection one: the
    // "select" branch also mutates selectedUuids via setSelection, which is
    // exactly what must not happen while a bulk action is still
    // reading/writing that same set.
    if (rejectConcurrentBulkAction()) {
      return;
    }

    if (isAllVisibleSelected.value) {
      clearSelection();
      return;
    }

    const visibleUuids = records.value.map((record) => record.attributes.uuid);
    setSelection(visibleUuids.slice(0, BULK_ACTION_MAX_BATCH_SIZE));

    if (visibleUuids.length > BULK_ACTION_MAX_BATCH_SIZE) {
      actionError.value = BULK_SELECTION_CAP_MESSAGE;
    }
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

  // A rejected bulk PATCH can still have committed rows server-side (see
  // fetchRecordOutcome above). Re-fetches exactly the uuids this batch
  // touched (not a full loadRecords(), which would drop any pages loaded via
  // loadMore) and reconciles the local list, selection, and actionError
  // against what the server actually confirms — returning the confirmed
  // records so a caller (e.g. a single-record retry) can tell "this uuid did
  // land despite the batch throwing" apart from "nothing happened".
  async function reconcileAfterFailedUpdate(
    uuids: string[],
    requestedStatus: RecordStatus,
    requestedSyncedAt: string | null,
  ): Promise<RecordResource[]> {
    const outcomesByUuid = await fetchRecordsByUuid(uuids);
    const { foundRecords, missingUuids, uncheckedCount } = partitionOutcomes(
      uuids,
      outcomesByUuid,
    );

    applyStatusUpdates(foundRecords);

    if (missingUuids.length > 0) {
      const missingSet = new Set(missingUuids);
      records.value = records.value.filter(
        (record) => !missingSet.has(record.attributes.uuid),
      );
    }

    await backfillIfEmptied();
    pruneSelection();

    const confirmedRecords = foundRecords.filter((record) =>
      matchesRequestedUpdate(record, requestedStatus, requestedSyncedAt),
    );
    deselectUuids(confirmedRecords.map((record) => record.attributes.uuid));

    // The catch block that calls this set a blanket "failed" message before
    // any of the above ran — revise it to what actually happened, since a
    // fully (or partially) confirmed batch reporting itself as failed is as
    // much a stale-state bug as the stale row list this function exists to
    // fix.
    if (confirmedRecords.length === uuids.length) {
      actionError.value = null;
    } else if (confirmedRecords.length > 0) {
      actionError.value = buildPartialUpdateMessage(
        confirmedRecords.length,
        uuids.length,
      );
    }

    if (uncheckedCount > 0 && actionError.value !== null) {
      actionError.value = `${actionError.value}${RECONCILE_INCOMPLETE_MESSAGE_SUFFIX}`;
    }

    return confirmedRecords;
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

    // The server only writes fields present in the payload — moving a
    // record to "synced" or "pending" without also clearing errorMessage
    // would leave a stale failure reason on a record the UI now shows as
    // healthy or not-yet-attempted. Only "error" itself should keep it.
    //
    // syncedAt itself is never sent in the request payload — the server
    // derives it and rejects a client-supplied value outright (see
    // BulkStatusUpdate and rejectClientSyncedAt in
    // server/api/records/index.patch.ts, markpost#265). This local timestamp
    // exists purely so a thrown request can still hand
    // reconcileAfterFailedUpdate below a lower bound to confirm against:
    // computed just before the request goes out, it's guaranteed to be at or
    // before whatever timestamp the server ends up stamping, so the ">="
    // check in matchesRequestedUpdate still tells "just synced by this
    // batch" apart from "was already synced before, this batch never
    // landed" without the client ever dictating the real value.
    const syncedAtForStatus =
      status === "synced" ? new Date().toISOString() : null;

    try {
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
        actionError.value = buildPartialUpdateMessage(
          updatedRecords.length,
          uuids.length,
        );
      }

      return updatedRecords;
    } catch (updateRequestError) {
      console.error(
        "[useRecords] updateRecordsStatus error:",
        updateRequestError,
      );
      actionError.value = "Failed to update records. Please try again.";
      return await reconcileAfterFailedUpdate(uuids, status, syncedAtForStatus);
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
