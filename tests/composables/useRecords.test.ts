import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

const { mockDownloadExport } = vi.hoisted(() => ({
  mockDownloadExport: vi.fn(),
}));

vi.mock("../../app/utils/exportDownload", () => ({
  downloadExport: mockDownloadExport,
}));

import {
  formatRelativeTime,
  formatSourceLabel,
  sourceTypeIcon,
  fetchRecordStats,
  buildFetchUrl,
  RECORD_FILTER_OPTIONS,
  triggerRecordExportDownload,
  useRecords,
  type RecordResource,
} from "../../app/composables/useRecords";
import { SOURCE_TYPES } from "../../shared/utils/sourceTypes";

describe("RECORD_FILTER_OPTIONS", () => {
  it("exposes every shared source type as a selectable filter", () => {
    const optionValues = RECORD_FILTER_OPTIONS.map((option) => option.value);
    for (const sourceType of SOURCE_TYPES) {
      expect(optionValues).toContain(sourceType);
    }
  });

  it("keeps the 'all' and 'errors' pseudo-filters alongside the source types", () => {
    const optionValues = RECORD_FILTER_OPTIONS.map((option) => option.value);
    expect(optionValues).toContain("all");
    expect(optionValues).toContain("errors");
    expect(optionValues).toHaveLength(SOURCE_TYPES.length + 2);
  });

  it("gives every option a non-empty label", () => {
    for (const option of RECORD_FILTER_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it("keeps source type values disjoint from the pseudo-filters", () => {
    const optionValues = RECORD_FILTER_OPTIONS.map((option) => option.value);
    expect(new Set(optionValues).size).toBe(optionValues.length);
    expect(SOURCE_TYPES).not.toContain("all");
    expect(SOURCE_TYPES).not.toContain("errors");
  });
});

describe("buildFetchUrl", () => {
  it("omits query params for the 'all' filter", () => {
    expect(buildFetchUrl("all")).toBe("/api/records");
  });

  it("maps the 'errors' filter to a status query", () => {
    expect(buildFetchUrl("errors")).toBe(
      "/api/records?filter%5Bstatus%5D=error",
    );
  });

  it.each(SOURCE_TYPES)(
    "maps the %s source type to a source query",
    (sourceType) => {
      expect(buildFetchUrl(sourceType)).toBe(
        `/api/records?filter%5Bsource%5D=${sourceType}`,
      );
    },
  );

  it("falls back to an unfiltered list and logs for an unknown filter", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Cast past the type system to exercise the runtime guard.
    expect(buildFetchUrl("bogus" as never)).toBe("/api/records");
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it("appends the cursor as page[after] for the 'all' filter", () => {
    expect(buildFetchUrl("all", "uuid-9")).toBe(
      "/api/records?page%5Bafter%5D=uuid-9",
    );
  });

  it("keeps the active filter alongside the cursor", () => {
    expect(buildFetchUrl("errors", "uuid-9")).toBe(
      "/api/records?filter%5Bstatus%5D=error&page%5Bafter%5D=uuid-9",
    );
  });
});

describe("sourceTypeIcon", () => {
  it("returns the mail icon for the email type", () => {
    expect(sourceTypeIcon("email")).toBe("mail");
  });

  it("returns the card icon for the stripe type", () => {
    expect(sourceTypeIcon("stripe")).toBe("card");
  });

  it("returns the github icon for the github type", () => {
    expect(sourceTypeIcon("github")).toBe("github");
  });

  it("returns the plug icon for the shortcuts type", () => {
    expect(sourceTypeIcon("shortcuts")).toBe("plug");
  });

  it("returns the zap icon for the webhook and zapier types", () => {
    expect(sourceTypeIcon("webhook")).toBe("zap");
    expect(sourceTypeIcon("zapier")).toBe("zap");
  });

  it("returns the zap icon for a null type", () => {
    expect(sourceTypeIcon(null)).toBe("zap");
  });

  it("returns the zap icon for an unrecognized type", () => {
    expect(sourceTypeIcon("mystery")).toBe("zap");
  });
});

describe("formatSourceLabel", () => {
  it("prefers the source display name so same-type sources stay distinct", () => {
    expect(formatSourceLabel("Prod deploys", "github")).toBe("Prod deploys");
    expect(formatSourceLabel("Staging deploys", "github")).toBe(
      "Staging deploys",
    );
  });

  it("falls back to the resolved type name when no source name is stored", () => {
    expect(formatSourceLabel(null, "webhook")).toBe("webhook");
    expect(formatSourceLabel(null, "email")).toBe("email");
  });

  it("shows a legacy type name outside the current set rather than 'unknown'", () => {
    expect(formatSourceLabel(null, "rss")).toBe("rss");
  });

  it("returns 'unknown' only when neither a source name nor a type is present", () => {
    expect(formatSourceLabel(null, null)).toBe("unknown");
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for times within the last minute", () => {
    const isoString = new Date(Date.now() - 30 * 1000).toISOString();
    expect(formatRelativeTime(isoString)).toBe("just now");
  });

  it("returns minutes ago for times within the last hour", () => {
    const isoString = new Date(Date.now() - 14 * 60 * 1000).toISOString();
    expect(formatRelativeTime(isoString)).toBe("14m ago");
  });

  it("returns hours ago for times within the same day", () => {
    const isoString = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(isoString)).toBe("3h ago");
  });

  it("returns 'yesterday' for times exactly 1 day ago", () => {
    const isoString = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(isoString)).toBe("yesterday");
  });

  it("returns days ago for times more than 1 day ago", () => {
    const isoString = new Date(
      Date.now() - 5 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(formatRelativeTime(isoString)).toBe("5d ago");
  });

  it("returns em-dash for an invalid date string", () => {
    expect(formatRelativeTime("not-a-date")).toBe("—");
  });

  it("returns em-dash for an empty string", () => {
    expect(formatRelativeTime("")).toBe("—");
  });
});

describe("triggerRecordExportDownload", () => {
  beforeEach(() => {
    mockDownloadExport.mockReset();
  });

  it("downloads the records export and returns the outcome", async () => {
    mockDownloadExport.mockResolvedValue({ status: "success" });

    const outcome = await triggerRecordExportDownload();

    expect(mockDownloadExport).toHaveBeenCalledWith(
      "/api/records/export",
      "markpost-records.json",
    );
    expect(outcome).toEqual({ status: "success" });
  });
});

describe("fetchRecordStats", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stats data on success", async () => {
    const statsData = { syncedToday: 5, pending: 2, errors: 1, thisMonth: 42 };
    mockFetch.mockResolvedValue({ data: statsData });

    const result = await fetchRecordStats();

    expect(result).toEqual(statsData);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("sends the browser time zone as the tz query param", async () => {
    const timeZone = "America/New_York";
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () =>
        ({ timeZone }) as Intl.ResolvedDateTimeFormatOptions,
    } as Intl.DateTimeFormat);
    mockFetch.mockResolvedValue({ data: null });

    await fetchRecordStats();

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/records/stats?tz=${encodeURIComponent(timeZone)}`,
    );
  });

  it("omits the tz param when the browser time zone is unavailable", async () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () =>
        ({ timeZone: "" }) as Intl.ResolvedDateTimeFormatOptions,
    } as Intl.DateTimeFormat);
    mockFetch.mockResolvedValue({ data: null });

    await fetchRecordStats();

    expect(mockFetch).toHaveBeenCalledWith("/api/records/stats");
  });

  it("returns null on fetch error", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const result = await fetchRecordStats();

    expect(result).toBeNull();
  });
});

function makeRecordResource(uuid: string): RecordResource {
  return {
    type: "records",
    id: uuid,
    attributes: {
      uuid,
      createdAt: "2026-06-27T10:00:00Z",
      userId: "user-1",
      title: `Record ${uuid}`,
      content: "content",
      sourceId: "source-1",
      source: "My GitHub hook",
      sourceType: "github",
      status: "synced",
      filePath: null,
      tags: null,
      frontmatter: null,
      syncedAt: null,
      errorMessage: null,
    },
    links: { self: `/api/records/${uuid}` },
  };
}

describe("useRecords loadRecords", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("populates records and hasMore from the first page", async () => {
    mockFetch.mockResolvedValue({
      data: [makeRecordResource("uuid-1")],
      meta: { hasMore: true },
    });

    const { records, hasMore, loadRecords } = useRecords("all");
    await loadRecords();

    expect(records.value).toHaveLength(1);
    expect(hasMore.value).toBe(true);
  });

  it("defaults hasMore to false when meta is absent", async () => {
    mockFetch.mockResolvedValue({ data: [makeRecordResource("uuid-1")] });

    const { hasMore, loadRecords } = useRecords("all");
    await loadRecords();

    expect(hasMore.value).toBe(false);
  });

  it("sets loadError when the first page fails", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const { loadError, loadRecords } = useRecords("all");
    await loadRecords();

    expect(loadError.value).toBe("Failed to load records. Please try again.");
  });
});

describe("useRecords loadMore", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("appends the next page using the last record as the cursor", async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-1")],
        meta: { hasMore: true },
      })
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-2")],
        meta: { hasMore: false },
      });

    const { records, hasMore, loadRecords, loadMore } = useRecords("all");
    await loadRecords();
    await loadMore();

    expect(records.value.map((record) => record.id)).toEqual([
      "uuid-1",
      "uuid-2",
    ]);
    expect(hasMore.value).toBe(false);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/records?page%5Bafter%5D=uuid-1",
    );
  });

  it("does nothing when there are no more records", async () => {
    mockFetch.mockResolvedValue({
      data: [makeRecordResource("uuid-1")],
      meta: { hasMore: false },
    });

    const { loadMore, loadRecords } = useRecords("all");
    await loadRecords();
    mockFetch.mockClear();
    await loadMore();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sets loadError when loading more fails", async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-1")],
        meta: { hasMore: true },
      })
      .mockRejectedValueOnce(new Error("network error"));

    const { loadError, loadRecords, loadMore } = useRecords("all");
    await loadRecords();
    await loadMore();

    expect(loadError.value).toBe(
      "Failed to load more records. Please try again.",
    );
  });
});
