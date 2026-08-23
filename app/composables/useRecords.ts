import {
  SOURCE_TYPES,
  isSourceType,
  type SourceType,
} from "#shared/utils/sourceTypes";
import { computeElapsedBuckets } from "../utils/timeBuckets";
import { downloadExport, type ExportOutcome } from "../utils/exportDownload";
import { RECORDS_EXPORT_FILENAME } from "#shared/utils/export";

export type RecordStatus = "synced" | "pending" | "error";

export type RecordAttributes = {
  uuid: string;
  createdAt: string;
  userId: string;
  title: string;
  content: string;
  sourceId: string | null;
  source: string | null;
  sourceType: SourceType | null;
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

  async function loadRecords(): Promise<void> {
    isLoading.value = true;
    loadError.value = null;

    try {
      const page = await fetchRecordList(filter.value);
      records.value = page.records;
      hasMore.value = page.hasMore;
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

  watch(filter, loadRecords);

  return {
    records,
    isLoading,
    isLoadingMore,
    loadError,
    hasMore,
    filter,
    loadRecords,
    loadMore,
  };
}
