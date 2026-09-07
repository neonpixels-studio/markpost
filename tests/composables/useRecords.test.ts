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
  BULK_ACTION_MAX_BATCH_SIZE,
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

  // Deliberate: a legacy `type/`-prefixed source name renders verbatim rather
  // than being split on `/`. Re-adding slash-stripping would reintroduce the
  // fragile prefix-parsing this change removed; the icon now conveys the type,
  // and the stored name is shown honestly. Pinned so the behavior stays chosen.
  it("renders a legacy prefixed source name verbatim (no slash-stripping)", () => {
    expect(formatSourceLabel("webhook/github", "webhook")).toBe(
      "webhook/github",
    );
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

describe("useRecords selection", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("starts with nothing selected", () => {
    const { selectedCount, isSelected } = useRecords("all");
    expect(selectedCount.value).toBe(0);
    expect(isSelected("uuid-1")).toBe(false);
  });

  it("toggles a uuid in and out of the selection", () => {
    const { selectedCount, isSelected, toggleSelection } = useRecords("all");

    toggleSelection("uuid-1");
    expect(isSelected("uuid-1")).toBe(true);
    expect(selectedCount.value).toBe(1);

    toggleSelection("uuid-1");
    expect(isSelected("uuid-1")).toBe(false);
    expect(selectedCount.value).toBe(0);
  });

  it("clears every selected uuid", () => {
    const { selectedCount, toggleSelection, clearSelection } =
      useRecords("all");

    toggleSelection("uuid-1");
    toggleSelection("uuid-2");
    expect(selectedCount.value).toBe(2);

    clearSelection();
    expect(selectedCount.value).toBe(0);
  });

  it("caps selection at BULK_ACTION_MAX_BATCH_SIZE and surfaces an error on the next attempt", () => {
    const { selectedCount, actionError, toggleSelection } = useRecords("all");

    for (let index = 0; index < BULK_ACTION_MAX_BATCH_SIZE; index += 1) {
      toggleSelection(`uuid-${index}`);
    }
    expect(actionError.value).toBeNull();

    toggleSelection("uuid-over-cap");

    expect(selectedCount.value).toBe(BULK_ACTION_MAX_BATCH_SIZE);
    expect(actionError.value).toBe(
      `You can select at most ${BULK_ACTION_MAX_BATCH_SIZE} records at a time.`,
    );
  });

  it("reports isAllVisibleSelected once every loaded record is selected", async () => {
    mockFetch.mockResolvedValue({
      data: [makeRecordResource("uuid-1"), makeRecordResource("uuid-2")],
      meta: { hasMore: false },
    });

    const {
      loadRecords,
      isAllVisibleSelected,
      toggleSelectAllVisible,
      selectedCount,
    } = useRecords("all");
    await loadRecords();

    expect(isAllVisibleSelected.value).toBe(false);

    toggleSelectAllVisible();
    expect(isAllVisibleSelected.value).toBe(true);
    expect(selectedCount.value).toBe(2);

    toggleSelectAllVisible();
    expect(isAllVisibleSelected.value).toBe(false);
    expect(selectedCount.value).toBe(0);
  });

  it("reports isAllVisibleSelected against the batch cap when more records are loaded than the cap allows", async () => {
    const oversizedPage = Array.from(
      { length: BULK_ACTION_MAX_BATCH_SIZE + 10 },
      (_unused, index) => makeRecordResource(`uuid-${index}`),
    );
    mockFetch.mockResolvedValue({
      data: oversizedPage,
      meta: { hasMore: false },
    });

    const {
      loadRecords,
      selectedCount,
      isAllVisibleSelected,
      toggleSelectAllVisible,
    } = useRecords("all");
    await loadRecords();

    // Selecting "all" can only ever reach the cap, so isAllVisibleSelected
    // must key off the capped set — otherwise the header checkbox could never
    // show checked, and a second click could never clear it. Assert the
    // selection size directly: isAllVisibleSelected alone can't tell a
    // correctly-capped selection from an over-cap one — both leave every
    // capped uuid selected, which is all that flag checks.
    toggleSelectAllVisible();
    expect(selectedCount.value).toBe(BULK_ACTION_MAX_BATCH_SIZE);
    expect(isAllVisibleSelected.value).toBe(true);

    toggleSelectAllVisible();
    expect(selectedCount.value).toBe(0);
    expect(isAllVisibleSelected.value).toBe(false);
  });

  it("drops a selected uuid that no longer appears after a reload", async () => {
    mockFetch.mockResolvedValueOnce({
      data: [makeRecordResource("uuid-1")],
      meta: { hasMore: false },
    });

    const { loadRecords, toggleSelection, isSelected, selectedCount } =
      useRecords("all");
    await loadRecords();
    toggleSelection("uuid-1");
    expect(selectedCount.value).toBe(1);

    mockFetch.mockResolvedValueOnce({
      data: [makeRecordResource("uuid-2")],
      meta: { hasMore: false },
    });
    await loadRecords();

    expect(isSelected("uuid-1")).toBe(false);
    expect(selectedCount.value).toBe(0);
  });
});

describe("useRecords deleteRecords", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("does nothing and skips the request for an empty uuid list", async () => {
    const { deleteRecords } = useRecords("all");
    const deletedCount = await deleteRecords([]);

    expect(deletedCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a batch larger than the cap without sending a request", async () => {
    const { actionError, deleteRecords } = useRecords("all");
    const uuids = Array.from(
      { length: BULK_ACTION_MAX_BATCH_SIZE + 1 },
      (_unused, index) => `uuid-${index}`,
    );

    const deletedCount = await deleteRecords(uuids);

    expect(deletedCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(actionError.value).toContain(String(BULK_ACTION_MAX_BATCH_SIZE));
  });

  it("sends a DELETE request with the given uuids and removes them from the list", async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-1"), makeRecordResource("uuid-2")],
        meta: { hasMore: false },
      })
      .mockResolvedValueOnce({ meta: { deleted: 1 } });

    const { loadRecords, records, deleteRecords } = useRecords("all");
    await loadRecords();

    const deletedCount = await deleteRecords(["uuid-1"]);

    expect(mockFetch).toHaveBeenLastCalledWith("/api/records", {
      method: "DELETE",
      body: { data: { attributes: { uuids: ["uuid-1"] } } },
    });
    expect(deletedCount).toBe(1);
    expect(records.value.map((record) => record.id)).toEqual(["uuid-2"]);
  });

  it("also drops a deleted uuid from the selection", async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-1")],
        meta: { hasMore: false },
      })
      .mockResolvedValueOnce({ meta: { deleted: 1 } });

    const { loadRecords, toggleSelection, selectedCount, deleteRecords } =
      useRecords("all");
    await loadRecords();
    toggleSelection("uuid-1");
    expect(selectedCount.value).toBe(1);

    await deleteRecords(["uuid-1"]);

    expect(selectedCount.value).toBe(0);
  });

  it("sets actionError and returns 0 when the request fails", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const { actionError, deleteRecords } = useRecords("all");
    const deletedCount = await deleteRecords(["uuid-1"]);

    expect(deletedCount).toBe(0);
    expect(actionError.value).toBe(
      "Failed to delete records. Please try again.",
    );
  });

  it("tracks isDeleting while the request is in flight", async () => {
    let resolveDelete!: (value: { meta: { deleted: number } }) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );

    const { isDeleting, deleteRecords } = useRecords("all");
    const pendingDelete = deleteRecords(["uuid-1"]);

    expect(isDeleting.value).toBe(true);
    resolveDelete({ meta: { deleted: 1 } });
    await pendingDelete;

    expect(isDeleting.value).toBe(false);
  });

  it("reloads and surfaces a mismatch instead of trusting a partial delete", async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-1"), makeRecordResource("uuid-2")],
        meta: { hasMore: false },
      })
      // Only 1 of the 2 requested uuids was actually deleted server-side.
      .mockResolvedValueOnce({ meta: { deleted: 1 } })
      // The reload that follows a mismatch.
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-2")],
        meta: { hasMore: false },
      });

    const { loadRecords, records, actionError, deleteRecords } =
      useRecords("all");
    await loadRecords();

    const deletedCount = await deleteRecords(["uuid-1", "uuid-2"]);

    expect(deletedCount).toBe(1);
    expect(actionError.value).toBe(
      "Deleted 1 of 2 records. Reloading the list.",
    );
    // Reflects the reload's response, not a locally-filtered guess.
    expect(records.value.map((record) => record.id)).toEqual(["uuid-2"]);
  });
});

describe("useRecords updateRecordsStatus", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("does nothing and skips the request for an empty uuid list", async () => {
    const { updateRecordsStatus } = useRecords("all");
    const updated = await updateRecordsStatus([], "synced");

    expect(updated).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a batch larger than the cap without sending a request", async () => {
    const { actionError, updateRecordsStatus } = useRecords("all");
    const uuids = Array.from(
      { length: BULK_ACTION_MAX_BATCH_SIZE + 1 },
      (_unused, index) => `uuid-${index}`,
    );

    const updated = await updateRecordsStatus(uuids, "synced");

    expect(updated).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(actionError.value).toContain(String(BULK_ACTION_MAX_BATCH_SIZE));
  });

  it("clears errorMessage when marking records as synced, since the server only writes fields it's given", async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: [
          {
            ...makeRecordResource("uuid-1"),
            attributes: {
              ...makeRecordResource("uuid-1").attributes,
              status: "error",
              errorMessage: "Sync failed: 500",
            },
          },
        ],
        meta: { hasMore: false },
      })
      .mockResolvedValueOnce({ data: [] });

    const { loadRecords, updateRecordsStatus } = useRecords("all");
    await loadRecords();

    await updateRecordsStatus(["uuid-1"], "synced");

    expect(mockFetch).toHaveBeenLastCalledWith("/api/records", {
      method: "PATCH",
      body: {
        data: {
          attributes: {
            records: [{ uuid: "uuid-1", status: "synced", errorMessage: null }],
          },
        },
      },
    });
  });

  it("does not send errorMessage when marking records as pending or error", async () => {
    mockFetch.mockResolvedValueOnce({ data: [] });

    const { updateRecordsStatus } = useRecords("all");
    await updateRecordsStatus(["uuid-1"], "error");

    expect(mockFetch).toHaveBeenLastCalledWith("/api/records", {
      method: "PATCH",
      body: {
        data: {
          attributes: { records: [{ uuid: "uuid-1", status: "error" }] },
        },
      },
    });
  });

  it("sends a PATCH request and merges the updated record in place", async () => {
    const originalRecord = makeRecordResource("uuid-1");
    const updatedRecord: RecordResource = {
      ...originalRecord,
      attributes: { ...originalRecord.attributes, status: "pending" },
    };
    mockFetch
      .mockResolvedValueOnce({
        data: [originalRecord],
        meta: { hasMore: false },
      })
      .mockResolvedValueOnce({ data: [updatedRecord] });

    const { loadRecords, records, updateRecordsStatus } = useRecords("all");
    await loadRecords();

    const updated = await updateRecordsStatus(["uuid-1"], "pending");

    expect(mockFetch).toHaveBeenLastCalledWith("/api/records", {
      method: "PATCH",
      body: {
        data: {
          attributes: { records: [{ uuid: "uuid-1", status: "pending" }] },
        },
      },
    });
    expect(updated).toEqual([updatedRecord]);
    expect(records.value[0]?.attributes.status).toBe("pending");
  });

  it("drops a record from the 'errors' filter once it's no longer an error", async () => {
    const errorRecord: RecordResource = {
      ...makeRecordResource("uuid-1"),
      attributes: {
        ...makeRecordResource("uuid-1").attributes,
        status: "error",
      },
    };
    const syncedRecord: RecordResource = {
      ...errorRecord,
      attributes: { ...errorRecord.attributes, status: "synced" },
    };
    mockFetch
      .mockResolvedValueOnce({ data: [errorRecord], meta: { hasMore: false } })
      .mockResolvedValueOnce({ data: [syncedRecord] });

    const { loadRecords, records, filter, updateRecordsStatus } =
      useRecords("errors");
    filter.value = "errors";
    await loadRecords();
    expect(records.value).toHaveLength(1);

    await updateRecordsStatus(["uuid-1"], "synced");

    expect(records.value).toHaveLength(0);
  });

  it("clears a selected uuid once its status update succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-1")],
        meta: { hasMore: false },
      })
      .mockResolvedValueOnce({ data: [makeRecordResource("uuid-1")] });

    const { loadRecords, toggleSelection, selectedCount, updateRecordsStatus } =
      useRecords("all");
    await loadRecords();
    toggleSelection("uuid-1");
    expect(selectedCount.value).toBe(1);

    await updateRecordsStatus(["uuid-1"], "synced");

    expect(selectedCount.value).toBe(0);
  });

  it("sets actionError and returns an empty list when the request fails", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const { actionError, updateRecordsStatus } = useRecords("all");
    const updated = await updateRecordsStatus(["uuid-1"], "synced");

    expect(updated).toEqual([]);
    expect(actionError.value).toBe(
      "Failed to update records. Please try again.",
    );
  });

  it("keeps only the un-updated uuid selected and surfaces a mismatch on a partial update", async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-1"), makeRecordResource("uuid-2")],
        meta: { hasMore: false },
      })
      // The server only echoes back uuid-1 — uuid-2's update didn't apply.
      .mockResolvedValueOnce({ data: [makeRecordResource("uuid-1")] });

    const {
      loadRecords,
      toggleSelection,
      isSelected,
      actionError,
      updateRecordsStatus,
    } = useRecords("all");
    await loadRecords();
    toggleSelection("uuid-1");
    toggleSelection("uuid-2");

    await updateRecordsStatus(["uuid-1", "uuid-2"], "synced");

    expect(isSelected("uuid-1")).toBe(false);
    expect(isSelected("uuid-2")).toBe(true);
    expect(actionError.value).toBe(
      "Updated 1 of 2 records. Please try again for the rest.",
    );
  });

  it("tracks isUpdatingStatus while the request is in flight", async () => {
    let resolvePatch!: (value: { data: RecordResource[] }) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolvePatch = resolve;
      }),
    );

    const { isUpdatingStatus, updateRecordsStatus } = useRecords("all");
    const pendingUpdate = updateRecordsStatus(["uuid-1"], "synced");

    expect(isUpdatingStatus.value).toBe(true);
    resolvePatch({ data: [] });
    await pendingUpdate;

    expect(isUpdatingStatus.value).toBe(false);
  });
});
