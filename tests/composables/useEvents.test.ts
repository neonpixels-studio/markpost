import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

const { mockDownloadExport } = vi.hoisted(() => ({
  mockDownloadExport: vi.fn(),
}));

vi.mock("../../app/utils/exportDownload", () => ({
  downloadExport: mockDownloadExport,
}));

import {
  eventToLogRow,
  triggerExportDownload,
  useEvents,
  buildEventsFetchUrl,
  EVENT_KIND_FILTER_OPTIONS,
  EVENT_SOURCE_FILTER_ALL,
  type EventResource,
} from "../../app/composables/useEvents";

function makeEvent(
  overrides: Partial<EventResource["attributes"]> = {},
): EventResource {
  const id = overrides.id ?? "evt-1";
  return {
    type: "events",
    id,
    attributes: {
      id,
      userId: "user-1",
      ts: "2026-06-27T09:41:02.000Z",
      kind: "ok",
      message: "webhook github:push → 99-incoming/deploy.md",
      recordUuid: null,
      sourceId: null,
      ...overrides,
    },
    links: { self: `/api/events/${id}` },
  };
}

describe("eventToLogRow", () => {
  it("formats the timestamp as HH:MM:SS", () => {
    const event = makeEvent({ ts: "2026-06-27T09:41:02.000Z" });
    const [time] = eventToLogRow(event);
    expect(time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("returns em-dash for an invalid timestamp", () => {
    const event = makeEvent({ ts: "not-a-date" });
    const [time] = eventToLogRow(event);
    expect(time).toBe("—");
  });

  it("passes through valid kind values", () => {
    for (const kind of ["ok", "dim", "warn", "err"] as const) {
      const event = makeEvent({ kind });
      const [, rowKind] = eventToLogRow(event);
      expect(rowKind).toBe(kind);
    }
  });

  it("falls back to 'dim' for an unrecognized kind", () => {
    const event = makeEvent({ kind: "unknown" });
    const [, rowKind] = eventToLogRow(event);
    expect(rowKind).toBe("dim");
  });

  it("passes through the message", () => {
    const event = makeEvent({ message: "test message" });
    const [, , message] = eventToLogRow(event);
    expect(message).toBe("test message");
  });
});

describe("triggerExportDownload", () => {
  beforeEach(() => {
    mockDownloadExport.mockReset();
  });

  it("downloads the activity export and returns the outcome", async () => {
    mockDownloadExport.mockResolvedValue({ status: "truncated" });

    const outcome = await triggerExportDownload();

    expect(mockDownloadExport).toHaveBeenCalledWith(
      "/api/events/export",
      "markpost-activity.json",
    );
    expect(outcome).toEqual({ status: "truncated" });
  });
});

describe("EVENT_KIND_FILTER_OPTIONS", () => {
  it("includes 'all' plus every event kind", () => {
    expect(EVENT_KIND_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      "all",
      "ok",
      "dim",
      "warn",
      "err",
    ]);
  });
});

describe("buildEventsFetchUrl", () => {
  it("returns the bare endpoint with no filters or cursor", () => {
    expect(buildEventsFetchUrl("all", EVENT_SOURCE_FILTER_ALL)).toBe(
      "/api/events",
    );
  });

  it("adds filter[kind] when a kind filter is active", () => {
    expect(buildEventsFetchUrl("err", EVENT_SOURCE_FILTER_ALL)).toBe(
      "/api/events?filter%5Bkind%5D=err",
    );
  });

  it("adds filter[sourceId] when a source filter is active", () => {
    expect(buildEventsFetchUrl("all", "source-uuid-1")).toBe(
      "/api/events?filter%5BsourceId%5D=source-uuid-1",
    );
  });

  it("combines both filters and a page[after] cursor", () => {
    const url = buildEventsFetchUrl("err", "source-uuid-1", "evt-1");
    expect(url).toBe(
      "/api/events?filter%5Bkind%5D=err&filter%5BsourceId%5D=source-uuid-1&page%5Bafter%5D=evt-1",
    );
  });
});

describe("useEvents", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("starts with empty events, isLoading true, and no active filters", () => {
    const { events, isLoading, loadError, hasMore, kindFilter, sourceFilter } =
      useEvents();
    expect(events.value).toEqual([]);
    expect(isLoading.value).toBe(true);
    expect(loadError.value).toBeNull();
    expect(hasMore.value).toBe(false);
    expect(kindFilter.value).toBe("all");
    expect(sourceFilter.value).toBe(EVENT_SOURCE_FILTER_ALL);
  });

  it("sets isLoading during fetch", async () => {
    let resolvePromise!: (value: unknown) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    );

    const { isLoading, loadEvents } = useEvents();
    const loadPromise = loadEvents();

    expect(isLoading.value).toBe(true);

    resolvePromise({ data: [] });
    await loadPromise;

    expect(isLoading.value).toBe(false);
  });

  it("fetches a single page and does not loop over further pages", async () => {
    const event = makeEvent();
    mockFetch.mockResolvedValue({ data: [event], meta: { hasMore: true } });

    const { events, hasMore, loadEvents } = useEvents();
    await loadEvents();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/events");
    expect(events.value).toHaveLength(1);
    expect(hasMore.value).toBe(true);
  });

  it("derives log rows from events", async () => {
    const event = makeEvent({ kind: "ok", message: "test msg" });
    mockFetch.mockResolvedValue({ data: [event] });

    const { log, loadEvents } = useEvents();
    await loadEvents();

    expect(log.value).toHaveLength(1);
    const [, kind, message] = log.value[0];
    expect(kind).toBe("ok");
    expect(message).toBe("test msg");
  });

  it("sets loadError on fetch failure", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const { loadError, loadEvents } = useEvents();
    await loadEvents();

    expect(loadError.value).toBe("Failed to load activity. Please try again.");
  });

  it("clears loadError on successful retry", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    mockFetch.mockResolvedValueOnce({ data: [] });

    const { loadError, loadEvents } = useEvents();
    await loadEvents();
    expect(loadError.value).not.toBeNull();

    await loadEvents();
    expect(loadError.value).toBeNull();
  });

  it("handles empty data array from API", async () => {
    mockFetch.mockResolvedValue({ data: [] });

    const { events, log, loadEvents } = useEvents();
    await loadEvents();

    expect(events.value).toEqual([]);
    expect(log.value).toEqual([]);
    expect(events.value).toHaveLength(0);
  });

  it("hasMore is false when meta.hasMore is absent", async () => {
    mockFetch.mockResolvedValue({ data: [makeEvent()] });

    const { hasMore, loadEvents } = useEvents();
    await loadEvents();

    expect(hasMore.value).toBe(false);
  });

  describe("loadMore", () => {
    it("does nothing when hasMore is false", async () => {
      mockFetch.mockResolvedValue({
        data: [makeEvent()],
        meta: { hasMore: false },
      });

      const { loadEvents, loadMore, events } = useEvents();
      await loadEvents();
      mockFetch.mockClear();

      await loadMore();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(events.value).toHaveLength(1);
    });

    it("fetches the next page using page[after] set to the last loaded event's id and appends", async () => {
      const eventPage1 = makeEvent({ id: "evt-1" });
      const eventPage2 = makeEvent({ id: "evt-2" });

      mockFetch
        .mockResolvedValueOnce({ data: [eventPage1], meta: { hasMore: true } })
        .mockResolvedValueOnce({
          data: [eventPage2],
          meta: { hasMore: false },
        });

      const { events, hasMore, loadEvents, loadMore } = useEvents();
      await loadEvents();
      await loadMore();

      expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/events");
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "/api/events?page%5Bafter%5D=evt-1",
      );
      expect(events.value).toHaveLength(2);
      expect(events.value[0].id).toBe("evt-1");
      expect(events.value[1].id).toBe("evt-2");
      expect(hasMore.value).toBe(false);
    });

    it("is a no-op when there are no events loaded yet", async () => {
      const { loadMore, events } = useEvents();
      await loadMore();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(events.value).toEqual([]);
    });

    it("sets a distinct loadError message on failure", async () => {
      mockFetch
        .mockResolvedValueOnce({ data: [makeEvent()], meta: { hasMore: true } })
        .mockRejectedValueOnce(new Error("network error"));

      const { loadEvents, loadMore, loadError } = useEvents();
      await loadEvents();
      await loadMore();

      expect(loadError.value).toBe(
        "Failed to load more activity. Please try again.",
      );
    });
  });

  describe("filters", () => {
    it("applies kindFilter to the request and resets pagination", async () => {
      mockFetch.mockResolvedValue({
        data: [makeEvent()],
        meta: { hasMore: true },
      });

      const { loadEvents, kindFilter, events } = useEvents();
      await loadEvents();
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({ data: [makeEvent({ id: "evt-2" })] });

      kindFilter.value = "err";
      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/events?filter%5Bkind%5D=err",
        );
      });

      // The filter change replaced the page rather than appending to it.
      expect(events.value).toHaveLength(1);
      expect(events.value[0].id).toBe("evt-2");
    });

    it("applies sourceFilter to the request", async () => {
      mockFetch.mockResolvedValue({ data: [] });

      const { loadEvents, sourceFilter } = useEvents();
      await loadEvents();
      mockFetch.mockClear();

      sourceFilter.value = "source-uuid-1";
      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/events?filter%5BsourceId%5D=source-uuid-1",
        );
      });
    });
  });
});
