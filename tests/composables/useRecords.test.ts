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
});

describe("sourceTypeIcon", () => {
  it("returns the mail icon for email sources", () => {
    expect(sourceTypeIcon("email/inbound/gmail")).toBe("mail");
  });

  it("returns the zap icon for non-email sources", () => {
    expect(sourceTypeIcon("webhook/github")).toBe("zap");
  });

  it("returns the zap icon for a null source", () => {
    expect(sourceTypeIcon(null)).toBe("zap");
  });
});

describe("formatSourceLabel", () => {
  it("returns 'unknown' for a null source", () => {
    expect(formatSourceLabel(null)).toBe("unknown");
  });

  it("returns the source unchanged when it has no slash", () => {
    expect(formatSourceLabel("webhook")).toBe("webhook");
  });

  it("drops the type prefix for a single-slash source", () => {
    expect(formatSourceLabel("webhook/github")).toBe("github");
  });

  it("joins remaining segments with a middot for a multi-slash source", () => {
    expect(formatSourceLabel("email/inbound/gmail")).toBe("inbound · gmail");
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

  it("returns stats data on success", async () => {
    const statsData = { syncedToday: 5, pending: 2, errors: 1, thisMonth: 42 };
    mockFetch.mockResolvedValue({ data: statsData });

    const result = await fetchRecordStats();

    expect(result).toEqual(statsData);
    expect(mockFetch).toHaveBeenCalledWith("/api/records/stats");
  });

  it("returns null on fetch error", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const result = await fetchRecordStats();

    expect(result).toBeNull();
  });
});
