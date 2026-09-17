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

  it("never reports isAllVisibleSelected for an empty record list", () => {
    const { isAllVisibleSelected, toggleSelectAllVisible, selectedCount } =
      useRecords("all");

    expect(isAllVisibleSelected.value).toBe(false);

    // A no-op guard: with nothing loaded there is nothing to select or clear,
    // and this must not disturb the (empty) selection or any pending message.
    toggleSelectAllVisible();
    expect(selectedCount.value).toBe(0);
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

  // Regression guard for #278: a partial-failure bulk action leaves the
  // still-failed uuids selected for retry, alongside an actionError
  // describing the failure. If clearSelection ran anyway while that request
  // was still in flight, it would wipe both out from under it, stranding the
  // eventual result with nothing selected to retry. The toolbar's "clear"
  // button is disabled during this window too, but the guard lives here
  // because clearSelection has a second caller — toggleSelectAllVisible,
  // reached via the header "select all" checkbox — that has no disabled
  // state of its own.
  it("does not clear the selection while a bulk action is in flight", async () => {
    let resolveDelete!: (value: { meta: { deleted: number } }) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );

    const {
      selectedCount,
      actionError,
      toggleSelection,
      clearSelection,
      deleteRecords,
    } = useRecords("all");
    toggleSelection("uuid-1");

    const pendingDelete = deleteRecords(["uuid-1"]);
    clearSelection();
    expect(selectedCount.value).toBe(1);
    // Fails loud, matching every other rejection in this file, rather than
    // silently dropping the click.
    expect(actionError.value).toBe(
      "Another bulk action is still running. Please wait.",
    );

    resolveDelete({ meta: { deleted: 1 } });
    await pendingDelete;

    // The action's own completion (pruneSelection) already empties the
    // selection here, so re-select something unrelated first — otherwise
    // this assertion would pass even if the guard never released.
    toggleSelection("uuid-2");
    expect(selectedCount.value).toBe(1);

    clearSelection();
    expect(selectedCount.value).toBe(0);
  });

  it("does not clear the selection via the header select-all toggle while a bulk action is in flight", async () => {
    mockFetch.mockResolvedValueOnce({
      data: [makeRecordResource("uuid-1"), makeRecordResource("uuid-2")],
      meta: { hasMore: false },
    });

    const {
      selectedCount,
      actionError,
      loadRecords,
      toggleSelectAllVisible,
      deleteRecords,
    } = useRecords("all");
    await loadRecords();
    toggleSelectAllVisible();
    expect(selectedCount.value).toBe(2);

    let resolveDelete!: (value: { meta: { deleted: number } }) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const pendingDelete = deleteRecords(["uuid-1", "uuid-2"]);

    // isAllVisibleSelected is still true, so this reaches the clearSelection
    // branch of toggleSelectAllVisible — the exact path the toolbar's
    // disabled "clear" button doesn't cover.
    toggleSelectAllVisible();
    expect(selectedCount.value).toBe(2);
    expect(actionError.value).toBe(
      "Another bulk action is still running. Please wait.",
    );

    resolveDelete({ meta: { deleted: 2 } });
    await pendingDelete;
  });

  it("does not grow the selection via the header select-all toggle's select branch while a bulk action is in flight", async () => {
    // Distinct from the test above: with fewer than all visible records
    // selected, isAllVisibleSelected is false, so toggleSelectAllVisible
    // takes its other branch (setSelection with every visible uuid) instead
    // of routing through clearSelection. That branch needs its own guard —
    // it mutates selectedUuids exactly as clearSelection does.
    mockFetch.mockResolvedValueOnce({
      data: [makeRecordResource("uuid-1"), makeRecordResource("uuid-2")],
      meta: { hasMore: false },
    });

    const {
      selectedCount,
      actionError,
      loadRecords,
      toggleSelection,
      toggleSelectAllVisible,
      deleteRecords,
    } = useRecords("all");
    await loadRecords();
    toggleSelection("uuid-1");
    expect(selectedCount.value).toBe(1);

    let resolveDelete!: (value: { meta: { deleted: number } }) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const pendingDelete = deleteRecords(["uuid-1"]);

    toggleSelectAllVisible();
    expect(selectedCount.value).toBe(1);
    expect(actionError.value).toBe(
      "Another bulk action is still running. Please wait.",
    );

    resolveDelete({ meta: { deleted: 1 } });
    await pendingDelete;
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

  it("clears the cap error once the selection drops back under the limit", () => {
    const { actionError, toggleSelection } = useRecords("all");

    for (let index = 0; index < BULK_ACTION_MAX_BATCH_SIZE; index += 1) {
      toggleSelection(`uuid-${index}`);
    }
    toggleSelection("uuid-over-cap");
    expect(actionError.value).not.toBeNull();

    // Deselecting one uuid routes through setSelection, which every legal
    // selection change goes through — the cap message must not linger once
    // the selection is legal again.
    toggleSelection("uuid-0");

    expect(actionError.value).toBeNull();
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

  it("never reports isAllVisibleSelected once more records are loaded than the cap allows, even with nothing left to load", async () => {
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

    // Selecting "all" can only ever reach the cap, leaving 10 loaded, visible
    // records unselected — isAllVisibleSelected must say so even though
    // hasMore is false (there is truly nothing more to load): "all selected"
    // is about the rows on screen, not about whether the server has anything
    // left to give.
    toggleSelectAllVisible();
    expect(selectedCount.value).toBe(BULK_ACTION_MAX_BATCH_SIZE);
    expect(isAllVisibleSelected.value).toBe(false);

    // A second click re-selects the identical capped set rather than
    // clearing, since isAllVisibleSelected never went true — the separate
    // clearSelection control is the way out of a capped selection.
    toggleSelectAllVisible();
    expect(selectedCount.value).toBe(BULK_ACTION_MAX_BATCH_SIZE);
  });

  it("surfaces a cap message when toggling select-all truncates the selection", async () => {
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
      actionError,
      selectedCount,
      selectedUuids,
      toggleSelectAllVisible,
    } = useRecords("all");
    await loadRecords();

    toggleSelectAllVisible();

    expect(selectedCount.value).toBe(BULK_ACTION_MAX_BATCH_SIZE);
    expect(actionError.value).toBe(
      `You can select at most ${BULK_ACTION_MAX_BATCH_SIZE} records at a time.`,
    );
    // Identity, not just cardinality: the first BULK_ACTION_MAX_BATCH_SIZE
    // records, not an arbitrary same-sized subset.
    expect([...selectedUuids.value]).toEqual(
      oversizedPage
        .slice(0, BULK_ACTION_MAX_BATCH_SIZE)
        .map((record) => record.attributes.uuid),
    );
  });

  it("does not surface a cap message when select-all fits under the cap", async () => {
    mockFetch.mockResolvedValue({
      data: [makeRecordResource("uuid-1"), makeRecordResource("uuid-2")],
      meta: { hasMore: false },
    });

    const { loadRecords, actionError, toggleSelectAllVisible } =
      useRecords("all");
    await loadRecords();

    toggleSelectAllVisible();

    expect(actionError.value).toBeNull();
  });

  it("stops reporting isAllVisibleSelected once loadMore reveals rows the cap can never reach", async () => {
    const cappedPage = Array.from(
      { length: BULK_ACTION_MAX_BATCH_SIZE },
      (_unused, index) => makeRecordResource(`uuid-${index}`),
    );
    const nextPage = [
      makeRecordResource("uuid-extra-1"),
      makeRecordResource("uuid-extra-2"),
    ];
    mockFetch
      .mockResolvedValueOnce({ data: cappedPage, meta: { hasMore: true } })
      .mockResolvedValueOnce({ data: nextPage, meta: { hasMore: true } });

    const {
      loadRecords,
      loadMore,
      isAllVisibleSelected,
      toggleSelectAllVisible,
    } = useRecords("all");
    await loadRecords();
    toggleSelectAllVisible();

    // The whole first (and so far only) page fits exactly within the cap and
    // is fully selected, so this honestly reports complete.
    expect(isAllVisibleSelected.value).toBe(true);

    // loadMore appends two more, now-visible rows that are not selected —
    // this is the bug: the old implementation kept reporting true here
    // because it only ever checked the first BULK_ACTION_MAX_BATCH_SIZE
    // uuids (unchanged by the append), ignoring that the loaded set had grown
    // past what "select all" could ever reach.
    await loadMore();

    expect(isAllVisibleSelected.value).toBe(false);
  });

  it("keeps isAllVisibleSelected false after loadMore even once the final page reports hasMore: false", async () => {
    const cappedPage = Array.from(
      { length: BULK_ACTION_MAX_BATCH_SIZE },
      (_unused, index) => makeRecordResource(`uuid-${index}`),
    );
    const finalPage = Array.from({ length: 20 }, (_unused, index) =>
      makeRecordResource(`uuid-extra-${index}`),
    );
    mockFetch
      .mockResolvedValueOnce({ data: cappedPage, meta: { hasMore: true } })
      .mockResolvedValueOnce({ data: finalPage, meta: { hasMore: false } });

    const {
      loadRecords,
      loadMore,
      selectedCount,
      isAllVisibleSelected,
      toggleSelectAllVisible,
    } = useRecords("all");
    await loadRecords();
    toggleSelectAllVisible();
    await loadMore();

    // The server has nothing left (hasMore: false), but 20 loaded, visible
    // rows past the cap are still unselected — "nothing more to load" is not
    // the same claim as "everything visible is selected", so this must stay
    // false rather than flipping true just because pagination ended.
    expect(selectedCount.value).toBe(BULK_ACTION_MAX_BATCH_SIZE);
    expect(isAllVisibleSelected.value).toBe(false);
  });

  it("reports isAllVisibleSelected and allows clearing when the loaded page lands exactly at the cap, even with more on the server", async () => {
    const cappedPage = Array.from(
      { length: BULK_ACTION_MAX_BATCH_SIZE },
      (_unused, index) => makeRecordResource(`uuid-${index}`),
    );
    mockFetch.mockResolvedValue({ data: cappedPage, meta: { hasMore: true } });

    const {
      loadRecords,
      selectedCount,
      isAllVisibleSelected,
      toggleSelectAllVisible,
    } = useRecords("all");
    await loadRecords();

    // Every currently visible row fits within the cap and gets selected, so
    // this is a true, non-stale "all selected" — the fact that hasMore is
    // true just means the server has rows not yet loaded, which is a
    // different question from whether everything on screen is checked.
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

  it("rejects a second bulk action while the first is still in flight", async () => {
    let resolveDelete!: (value: { meta: { deleted: number } }) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );

    const { actionError, deleteRecords, updateRecordsStatus } =
      useRecords("all");
    const pendingDelete = deleteRecords(["uuid-1"]);

    const secondDeleteCount = await deleteRecords(["uuid-2"]);
    expect(secondDeleteCount).toBe(0);
    expect(actionError.value).toBe(
      "Another bulk action is still running. Please wait.",
    );

    const updateResult = await updateRecordsStatus(["uuid-2"], "synced");
    expect(updateResult).toEqual([]);

    resolveDelete({ meta: { deleted: 1 } });
    await pendingDelete;
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

  it("reloads from the server when deleting empties the page but more records remain", async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-1")],
        meta: { hasMore: true },
      })
      .mockResolvedValueOnce({ meta: { deleted: 1 } })
      // The backfill reload triggered because the page is now empty.
      .mockResolvedValueOnce({
        data: [makeRecordResource("uuid-2")],
        meta: { hasMore: false },
      });

    const { loadRecords, records, hasMore, deleteRecords } = useRecords("all");
    await loadRecords();
    expect(hasMore.value).toBe(true);

    await deleteRecords(["uuid-1"]);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(records.value.map((record) => record.id)).toEqual(["uuid-2"]);
    expect(hasMore.value).toBe(false);
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

  it("clears errorMessage but never sends syncedAt when marking records as synced, since only the server knows which selected rows are already synced", async () => {
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
            records: [
              {
                uuid: "uuid-1",
                status: "synced",
                errorMessage: null,
              },
            ],
          },
        },
      },
    });
  });

  it("does not send errorMessage or syncedAt when marking records as error, since the failure reason should stick and syncedAt is server-derived", async () => {
    mockFetch.mockResolvedValueOnce({ data: [] });

    const { updateRecordsStatus } = useRecords("all");
    await updateRecordsStatus(["uuid-1"], "error");

    expect(mockFetch).toHaveBeenLastCalledWith("/api/records", {
      method: "PATCH",
      body: {
        data: {
          attributes: {
            records: [{ uuid: "uuid-1", status: "error" }],
          },
        },
      },
    });
  });

  it("clears errorMessage but never sends syncedAt when marking records as pending, so a stale failure reason doesn't linger and the server retains control of syncedAt", async () => {
    mockFetch.mockResolvedValueOnce({ data: [] });

    const { updateRecordsStatus } = useRecords("all");
    await updateRecordsStatus(["uuid-1"], "pending");

    expect(mockFetch).toHaveBeenLastCalledWith("/api/records", {
      method: "PATCH",
      body: {
        data: {
          attributes: {
            records: [
              {
                uuid: "uuid-1",
                status: "pending",
                errorMessage: null,
              },
            ],
          },
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
          attributes: {
            records: [
              {
                uuid: "uuid-1",
                status: "pending",
                errorMessage: null,
              },
            ],
          },
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

  it("reloads from the server when a status update empties the filtered page but more records remain", async () => {
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
    const nextErrorRecord: RecordResource = {
      ...makeRecordResource("uuid-2"),
      attributes: {
        ...makeRecordResource("uuid-2").attributes,
        status: "error",
      },
    };
    mockFetch
      .mockResolvedValueOnce({ data: [errorRecord], meta: { hasMore: true } })
      .mockResolvedValueOnce({ data: [syncedRecord] })
      // The backfill reload triggered because the "errors" page is now empty.
      .mockResolvedValueOnce({
        data: [nextErrorRecord],
        meta: { hasMore: false },
      });

    const { loadRecords, records, hasMore, filter, updateRecordsStatus } =
      useRecords("errors");
    filter.value = "errors";
    await loadRecords();
    expect(hasMore.value).toBe(true);

    await updateRecordsStatus(["uuid-1"], "synced");

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(records.value.map((record) => record.id)).toEqual(["uuid-2"]);
    expect(hasMore.value).toBe(false);
  });

  it("keeps a record under a source filter once its status changes, since the filter isn't status-based", async () => {
    const githubRecord: RecordResource = {
      ...makeRecordResource("uuid-1"),
      attributes: {
        ...makeRecordResource("uuid-1").attributes,
        sourceType: "github",
        status: "pending",
      },
    };
    const syncedGithubRecord: RecordResource = {
      ...githubRecord,
      attributes: { ...githubRecord.attributes, status: "synced" },
    };
    mockFetch
      .mockResolvedValueOnce({
        data: [githubRecord],
        meta: { hasMore: false },
      })
      .mockResolvedValueOnce({ data: [syncedGithubRecord] });

    const { loadRecords, records, filter, updateRecordsStatus } =
      useRecords("github");
    filter.value = "github";
    await loadRecords();
    expect(records.value).toHaveLength(1);

    await updateRecordsStatus(["uuid-1"], "synced");

    expect(records.value).toHaveLength(1);
    expect(records.value[0]?.attributes.status).toBe("synced");
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
    // Every call rejects, including the reconcile re-check that follows —
    // an outage severe enough to fail the PATCH plausibly also fails the
    // GETs used to reconcile it, so the message picks up the "could not be
    // re-checked" caveat too.
    mockFetch.mockRejectedValue(new Error("network error"));

    const { actionError, updateRecordsStatus } = useRecords("all");
    const updated = await updateRecordsStatus(["uuid-1"], "synced");

    expect(updated).toEqual([]);
    expect(actionError.value).toBe(
      "Failed to update records. Please try again. Some records could not be re-checked — refresh to confirm their status.",
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

  it("reconciles affected rows with the server after a failed bulk PATCH, since Promise.all on the server can commit some rows before rejecting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00Z"));
    const pendingRecordOne: RecordResource = {
      ...makeRecordResource("uuid-1"),
      attributes: {
        ...makeRecordResource("uuid-1").attributes,
        status: "pending",
      },
    };
    const pendingRecordTwo: RecordResource = {
      ...makeRecordResource("uuid-2"),
      attributes: {
        ...makeRecordResource("uuid-2").attributes,
        status: "pending",
      },
    };
    mockFetch
      .mockResolvedValueOnce({
        data: [pendingRecordOne, pendingRecordTwo],
        meta: { hasMore: false },
      })
      // The bulk PATCH itself rejects (e.g. the server errored mid-batch).
      .mockRejectedValueOnce(new Error("mid-batch failure"))
      // uuid-1's row had already committed server-side before the
      // rejection — status, syncedAt, and errorMessage all reflect the
      // requested write, which is what distinguishes "actually applied"
      // from merely already matching the target status.
      .mockResolvedValueOnce({
        data: {
          ...pendingRecordOne,
          attributes: {
            ...pendingRecordOne.attributes,
            status: "synced",
            syncedAt: "2026-06-27T12:00:00.000Z",
            errorMessage: null,
          },
        },
      })
      // uuid-2 never committed — still reflects its prior state.
      .mockResolvedValueOnce({ data: pendingRecordTwo });

    const {
      loadRecords,
      toggleSelection,
      isSelected,
      records,
      actionError,
      updateRecordsStatus,
    } = useRecords("all");
    await loadRecords();
    toggleSelection("uuid-1");
    toggleSelection("uuid-2");

    const updated = await updateRecordsStatus(["uuid-1", "uuid-2"], "synced");

    // A caller (e.g. a single-record retry reading updated[0]) must be able
    // to see that uuid-1 actually landed despite the batch throwing, instead
    // of always getting an empty result indistinguishable from "nothing
    // happened".
    expect(updated.map((record) => record.attributes.uuid)).toEqual(["uuid-1"]);

    // The UI must reflect the server's true state for the committed row
    // instead of staying stuck on the pre-request "pending" snapshot.
    expect(
      records.value.find((record) => record.id === "uuid-1")?.attributes.status,
    ).toBe("synced");
    expect(
      records.value.find((record) => record.id === "uuid-2")?.attributes.status,
    ).toBe("pending");

    // uuid-1 actually applied, so it's cleared for the user; uuid-2 didn't,
    // so it stays selected for a retry.
    expect(isSelected("uuid-1")).toBe(false);
    expect(isSelected("uuid-2")).toBe(true);
    // The reconciled outcome — one of two actually landed — replaces the
    // blanket "failed" message set before reconcile ran; reporting "failed"
    // here would contradict the row that just flipped to "synced" above.
    expect(actionError.value).toBe(
      "Updated 1 of 2 records. Please try again for the rest.",
    );

    vi.useRealTimers();
  });

  it("drops a uuid from the list entirely when it no longer exists after a failed bulk PATCH", async () => {
    const recordOne = makeRecordResource("uuid-1");
    const notFoundError = Object.assign(new Error("Not Found"), {
      statusCode: 404,
    });
    mockFetch
      .mockResolvedValueOnce({
        data: [recordOne],
        meta: { hasMore: false },
      })
      .mockRejectedValueOnce(new Error("mid-batch failure"))
      // The row was deleted concurrently, so the reconcile fetch 404s.
      .mockRejectedValueOnce(notFoundError);

    const { loadRecords, records, actionError, updateRecordsStatus } =
      useRecords("all");
    await loadRecords();

    await updateRecordsStatus(["uuid-1"], "synced");

    expect(records.value).toHaveLength(0);
    expect(actionError.value).toBe(
      "Failed to update records. Please try again.",
    );
  });

  it("keeps a row and its selection untouched when its reconcile re-check fails for a reason other than 404, since that failure could be transient rather than proof the row is gone", async () => {
    const recordOne: RecordResource = {
      ...makeRecordResource("uuid-1"),
      attributes: {
        ...makeRecordResource("uuid-1").attributes,
        status: "pending",
      },
    };
    const serverError = Object.assign(new Error("Internal Server Error"), {
      statusCode: 500,
    });
    mockFetch
      .mockResolvedValueOnce({
        data: [recordOne],
        meta: { hasMore: false },
      })
      .mockRejectedValueOnce(new Error("mid-batch failure"))
      // The reconcile re-check itself fails — must NOT be treated the same
      // as a confirmed 404, or a transient outage would silently delete a
      // row the server still has.
      .mockRejectedValueOnce(serverError);

    const {
      loadRecords,
      toggleSelection,
      isSelected,
      records,
      actionError,
      updateRecordsStatus,
    } = useRecords("all");
    await loadRecords();
    toggleSelection("uuid-1");

    await updateRecordsStatus(["uuid-1"], "synced");

    expect(records.value.map((record) => record.id)).toEqual(["uuid-1"]);
    expect(records.value[0]?.attributes.status).toBe("pending");
    expect(isSelected("uuid-1")).toBe(true);
    expect(actionError.value).toBe(
      "Failed to update records. Please try again. Some records could not be re-checked — refresh to confirm their status.",
    );
  });

  it("does not confirm an already-synced record as 'just applied' when its stale syncedAt proves the write never landed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00Z"));

    // Already synced from a prior sync, well before this request's timestamp.
    const staleSyncedRecord: RecordResource = {
      ...makeRecordResource("uuid-1"),
      attributes: {
        ...makeRecordResource("uuid-1").attributes,
        status: "synced",
        syncedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    mockFetch
      .mockResolvedValueOnce({
        data: [staleSyncedRecord],
        meta: { hasMore: false },
      })
      .mockRejectedValueOnce(new Error("mid-batch failure"))
      // Reconcile refetches the exact same untouched row — the PATCH never
      // actually re-stamped syncedAt.
      .mockResolvedValueOnce({ data: staleSyncedRecord });

    const {
      loadRecords,
      toggleSelection,
      isSelected,
      actionError,
      updateRecordsStatus,
    } = useRecords("all");
    await loadRecords();
    toggleSelection("uuid-1");

    const updated = await updateRecordsStatus(["uuid-1"], "synced");

    // Status alone matches ("synced"), but the timestamp proves this
    // request's write never landed — the stats card that keys off *when*
    // syncedAt was set would otherwise silently miss this record.
    expect(updated).toEqual([]);
    expect(isSelected("uuid-1")).toBe(true);
    expect(actionError.value).toBe(
      "Failed to update records. Please try again.",
    );

    vi.useRealTimers();
  });

  it("reconciles every uuid in a failed batch even when it exceeds the concurrency pool size", async () => {
    const uuids = Array.from(
      { length: 7 },
      (_unused, index) => `uuid-${index}`,
    );
    const pendingRecords = uuids.map((uuid) => ({
      ...makeRecordResource(uuid),
      attributes: {
        ...makeRecordResource(uuid).attributes,
        status: "pending" as const,
      },
    }));

    mockFetch.mockResolvedValueOnce({
      data: pendingRecords,
      meta: { hasMore: false },
    });
    mockFetch.mockRejectedValueOnce(new Error("mid-batch failure"));
    pendingRecords.forEach((record) => {
      mockFetch.mockResolvedValueOnce({ data: record });
    });

    const { loadRecords, updateRecordsStatus } = useRecords("all");
    await loadRecords();

    await updateRecordsStatus(uuids, "pending");

    // The worker pool (RECONCILE_FETCH_CONCURRENCY = 5) must still drain the
    // full queue rather than stopping once its initial batch of workers runs
    // out of uuids to claim.
    const requestedDetailUrls = mockFetch.mock.calls
      .map(([url]) => url)
      .filter(
        (url): url is string =>
          typeof url === "string" && url.startsWith("/api/records/uuid-"),
      );
    expect(new Set(requestedDetailUrls)).toEqual(
      new Set(uuids.map((uuid) => `/api/records/${uuid}`)),
    );
  });

  it("never runs more than RECONCILE_FETCH_CONCURRENCY reconcile GETs at once", async () => {
    const uuids = Array.from(
      { length: 7 },
      (_unused, index) => `uuid-${index}`,
    );
    const RECONCILE_FETCH_CONCURRENCY = 5;
    const pendingRecords = uuids.map((uuid) => ({
      ...makeRecordResource(uuid),
      attributes: {
        ...makeRecordResource(uuid).attributes,
        status: "pending" as const,
      },
    }));

    let inFlightCount = 0;
    let maxInFlightCount = 0;
    const deferredResolvers: Array<() => void> = [];

    mockFetch.mockImplementation(
      (url: string, options?: { method?: string }) => {
        if (url === "/api/records" && options?.method !== "PATCH") {
          return Promise.resolve({
            data: pendingRecords,
            meta: { hasMore: false },
          });
        }

        if (url === "/api/records" && options?.method === "PATCH") {
          return Promise.reject(new Error("mid-batch failure"));
        }

        // A reconcile detail GET: stays pending until the test explicitly
        // releases it, so the test can observe exactly how many are
        // in flight at once.
        inFlightCount += 1;
        maxInFlightCount = Math.max(maxInFlightCount, inFlightCount);

        return new Promise((resolve) => {
          deferredResolvers.push(() => {
            inFlightCount -= 1;
            const uuid = url.replace("/api/records/", "");
            const record = pendingRecords.find(
              (candidate) => candidate.attributes.uuid === uuid,
            );
            resolve({ data: record });
          });
        });
      },
    );

    const { loadRecords, updateRecordsStatus } = useRecords("all");
    await loadRecords();

    const updatePromise = updateRecordsStatus(uuids, "pending");

    // The first wave claims exactly the concurrency cap, never all 7 at once.
    await vi.waitFor(() =>
      expect(deferredResolvers).toHaveLength(RECONCILE_FETCH_CONCURRENCY),
    );
    expect(maxInFlightCount).toBe(RECONCILE_FETCH_CONCURRENCY);

    deferredResolvers
      .splice(0, RECONCILE_FETCH_CONCURRENCY)
      .forEach((resolve) => resolve());

    // Freed workers claim the remaining uuids, but the pool still never
    // exceeds its cap even as the second wave starts.
    await vi.waitFor(() =>
      expect(deferredResolvers).toHaveLength(
        uuids.length - RECONCILE_FETCH_CONCURRENCY,
      ),
    );
    expect(maxInFlightCount).toBe(RECONCILE_FETCH_CONCURRENCY);

    deferredResolvers.splice(0).forEach((resolve) => resolve());

    await updatePromise;
  });

  it("reloads from the server when a failed bulk PATCH's reconcile empties the filtered page but more records remain", async () => {
    const errorRecord: RecordResource = {
      ...makeRecordResource("uuid-1"),
      attributes: {
        ...makeRecordResource("uuid-1").attributes,
        status: "error",
      },
    };
    const confirmedSyncedRecord: RecordResource = {
      ...errorRecord,
      attributes: {
        ...errorRecord.attributes,
        status: "synced",
        syncedAt: "2026-06-27T12:00:00.000Z",
        errorMessage: null,
      },
    };
    const nextErrorRecord: RecordResource = {
      ...makeRecordResource("uuid-2"),
      attributes: {
        ...makeRecordResource("uuid-2").attributes,
        status: "error",
      },
    };
    mockFetch
      .mockResolvedValueOnce({ data: [errorRecord], meta: { hasMore: true } })
      .mockRejectedValueOnce(new Error("mid-batch failure"))
      // The reconcile re-check shows uuid-1 actually landed as "synced",
      // which drops it out of the active "errors" filter.
      .mockResolvedValueOnce({ data: confirmedSyncedRecord })
      // The backfill reload triggered because the "errors" page is now
      // empty even though more error records exist server-side.
      .mockResolvedValueOnce({
        data: [nextErrorRecord],
        meta: { hasMore: false },
      });

    const { loadRecords, records, hasMore, filter, updateRecordsStatus } =
      useRecords("errors");
    filter.value = "errors";
    await loadRecords();
    expect(hasMore.value).toBe(true);

    await updateRecordsStatus(["uuid-1"], "synced");

    expect(records.value.map((record) => record.id)).toEqual(["uuid-2"]);
    expect(hasMore.value).toBe(false);
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
