import { downloadExport, type ExportOutcome } from "../utils/exportDownload";
import { ACTIVITY_EXPORT_FILENAME } from "#shared/utils/export";

export type EventKind = "ok" | "dim" | "warn" | "err";

// Client-side source of truth for the four kinds the server's EVENT_KINDS
// (server/db/schema.ts) can emit — kept as a literal array here (rather than
// importing the server constant) so app/ code never reaches across the
// client/server boundary, matching #shared/utils/sourceTypes's own pattern of
// a separately declared, parallel list.
export const EVENT_KINDS: readonly EventKind[] = ["ok", "dim", "warn", "err"];

export type EventAttributes = {
  id: string;
  userId: string;
  ts: string;
  kind: string;
  message: string;
  recordUuid: string | null;
  sourceId: string | null;
};

export type EventResource = {
  type: "events";
  id: string;
  attributes: EventAttributes;
  links: { self: string };
};

type EventListResponse = {
  data: EventResource[];
  meta?: {
    total?: number;
    size?: number;
    hasMore?: boolean;
  };
};

export type LogRow = [string, EventKind, string];

export type EventKindFilterValue = "all" | EventKind;

type FilterOption = {
  readonly value: string;
  readonly label: string;
};

// Mirrors RECORD_FILTER_OPTIONS (useRecords.ts): driven from EVENT_KINDS so
// every kind the API filters on stays reachable in the UI, with labels equal
// to the raw value to keep this the single source of truth.
export const EVENT_KIND_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: "all", label: "all" },
  ...EVENT_KINDS.map((kind) => ({ value: kind, label: kind })),
];

// Sentinel for "no source filter applied" — sourceId values are otherwise
// real source uuids, so "all" (not a valid uuid) can never collide with one.
export const EVENT_SOURCE_FILTER_ALL = "all";

const EXPORT_URL = "/api/events/export";

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function isValidKind(kind: string): kind is EventKind {
  return kind === "ok" || kind === "dim" || kind === "warn" || kind === "err";
}

export function eventToLogRow(event: EventResource): LogRow {
  const time = formatTimestamp(event.attributes.ts);
  const kind = isValidKind(event.attributes.kind)
    ? event.attributes.kind
    : "dim";
  return [time, kind, event.attributes.message];
}

async function fetchEventPage(url: string): Promise<EventListResponse> {
  return $fetch<EventListResponse>(url);
}

// Builds the query string by hand rather than following the server's
// links.next (which does carry the active filters — see the comment on
// eventPaginationLinks in server/utils/response.ts) so the very first page
// request, before any link exists yet, still applies filter[kind] /
// filter[sourceId]. Mirrors useRecords.ts's buildFetchUrl.
export function buildEventsFetchUrl(
  kindFilter: EventKindFilterValue,
  sourceFilter: string,
  afterId?: string,
): string {
  const params = new URLSearchParams();

  if (kindFilter !== "all") {
    params.set("filter[kind]", kindFilter);
  }

  if (sourceFilter !== EVENT_SOURCE_FILTER_ALL) {
    params.set("filter[sourceId]", sourceFilter);
  }

  if (afterId) {
    params.set("page[after]", afterId);
  }

  const queryString = params.toString();
  return queryString ? `/api/events?${queryString}` : "/api/events";
}

type EventPage = {
  events: EventResource[];
  hasMore: boolean;
};

async function fetchEventsPage(
  kindFilter: EventKindFilterValue,
  sourceFilter: string,
  afterId?: string,
): Promise<EventPage> {
  const url = buildEventsFetchUrl(kindFilter, sourceFilter, afterId);
  const response = await fetchEventPage(url);
  return {
    events: response.data ?? [],
    hasMore: response.meta?.hasMore ?? false,
  };
}

export function triggerExportDownload(): Promise<ExportOutcome> {
  return downloadExport(EXPORT_URL, ACTIVITY_EXPORT_FILENAME);
}

export function useEvents() {
  const events = ref<EventResource[]>([]);
  const isLoading = ref(true);
  const isLoadingMore = ref(false);
  const loadError = ref<string | null>(null);
  const hasMore = ref(false);
  const kindFilter = ref<EventKindFilterValue>("all");
  const sourceFilter = ref<string>(EVENT_SOURCE_FILTER_ALL);

  const log = computed<LogRow[]>(() => events.value.map(eventToLogRow));

  // Always fetches page one, replacing whatever was loaded before — the sole
  // entry point for a fresh view of the feed, whether that's the initial
  // mount or a filter change resetting pagination (see the watch below).
  async function loadEvents(): Promise<void> {
    isLoading.value = true;
    loadError.value = null;

    try {
      const page = await fetchEventsPage(kindFilter.value, sourceFilter.value);
      events.value = page.events;
      hasMore.value = page.hasMore;
    } catch (fetchError) {
      console.error("[useEvents] loadEvents error:", fetchError);
      loadError.value = "Failed to load activity. Please try again.";
    } finally {
      isLoading.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (isLoadingMore.value || !hasMore.value) {
      return;
    }

    const lastEvent = events.value.at(-1);
    if (!lastEvent) {
      return;
    }

    isLoadingMore.value = true;
    loadError.value = null;

    try {
      const page = await fetchEventsPage(
        kindFilter.value,
        sourceFilter.value,
        lastEvent.id,
      );
      events.value = [...events.value, ...page.events];
      hasMore.value = page.hasMore;
    } catch (fetchError) {
      console.error("[useEvents] loadMore error:", fetchError);
      loadError.value = "Failed to load more activity. Please try again.";
    } finally {
      isLoadingMore.value = false;
    }
  }

  // Mirrors useRecords.ts's watch(filter, loadRecords): either filter
  // changing resets pagination to a fresh page one rather than appending
  // onto a now-stale list.
  watch([kindFilter, sourceFilter], loadEvents);

  return {
    events,
    log,
    isLoading,
    isLoadingMore,
    loadError,
    hasMore,
    kindFilter,
    sourceFilter,
    loadEvents,
    loadMore,
  };
}
