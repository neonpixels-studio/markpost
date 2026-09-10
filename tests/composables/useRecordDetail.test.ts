import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

import {
  fetchRecord,
  useRecordDetail,
} from "../../app/composables/useRecordDetail";

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    type: "records" as const,
    id: "uuid-1",
    attributes: {
      uuid: "uuid-1",
      createdAt: "2026-06-27T10:00:00Z",
      userId: "user-1",
      title: "Test Record",
      content: "Content here",
      sourceId: null,
      source: "webhook/github",
      status: "synced",
      filePath: "99-incoming/test.md",
      tags: null,
      frontmatter: null,
      syncedAt: null,
      errorMessage: null,
      ...overrides,
    },
    links: { self: "/api/records/uuid-1" },
  };
}

describe("fetchRecord", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("requests the single-record endpoint for the given uuid", async () => {
    const record = makeRecord();
    mockFetch.mockResolvedValue({ data: record });

    const result = await fetchRecord("uuid-1");

    expect(mockFetch).toHaveBeenCalledWith("/api/records/uuid-1");
    expect(result).toEqual(record);
  });

  it("returns null when the endpoint responds with no data", async () => {
    mockFetch.mockResolvedValue({ data: null });

    const result = await fetchRecord("missing");

    expect(result).toBeNull();
  });
});

describe("useRecordDetail", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch.mockReset();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("loads a record and clears the loading flag", async () => {
    const record = makeRecord();
    mockFetch.mockResolvedValue({ data: record });

    const detail = useRecordDetail();
    await detail.open("uuid-1");

    expect(detail.record.value).toEqual(record);
    expect(detail.isLoading.value).toBe(false);
    expect(detail.loadError.value).toBeNull();
  });

  it("sets a not-found error when the record is missing", async () => {
    mockFetch.mockResolvedValue({ data: null });

    const detail = useRecordDetail();
    await detail.open("missing");

    expect(detail.record.value).toBeNull();
    expect(detail.loadError.value).toContain("not found");
  });

  it("sets a load error when the fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const detail = useRecordDetail();
    await detail.open("uuid-1");

    expect(detail.record.value).toBeNull();
    expect(detail.loadError.value).toContain("Failed to load");
    expect(detail.isLoading.value).toBe(false);
  });

  it("sets a not-found error when the fetch rejects with a 404", async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error("Not Found"), { statusCode: 404 }),
    );

    const detail = useRecordDetail();
    await detail.open("gone");

    expect(detail.record.value).toBeNull();
    expect(detail.loadError.value).toContain("not found");
    expect(detail.isLoading.value).toBe(false);
  });

  it("treats a rejection carrying a plain status of 404 as not found", async () => {
    mockFetch.mockRejectedValue({ status: 404 });

    const detail = useRecordDetail();
    await detail.open("gone");

    expect(detail.loadError.value).toContain("not found");
  });

  it("encodes the uuid in the request path", async () => {
    mockFetch.mockResolvedValue({ data: null });

    await fetchRecord("a/b?c");

    expect(mockFetch).toHaveBeenCalledWith("/api/records/a%2Fb%3Fc");
  });

  it("drops a stale response when a newer open supersedes it", async () => {
    const slowRecord = makeRecord({ uuid: "slow" });
    const fastRecord = makeRecord({ uuid: "fast" });

    let resolveSlow: (value: unknown) => void = () => {};
    const slowPromise = new Promise((resolve) => {
      resolveSlow = resolve;
    });
    mockFetch.mockReturnValueOnce(slowPromise);
    mockFetch.mockResolvedValueOnce({ data: fastRecord });

    const detail = useRecordDetail();
    const slowOpen = detail.open("slow");
    await detail.open("fast");

    resolveSlow({ data: slowRecord });
    await slowOpen;

    expect(detail.record.value).toEqual(fastRecord);
  });

  it("resets state on close", async () => {
    const record = makeRecord();
    mockFetch.mockResolvedValue({ data: record });

    const detail = useRecordDetail();
    await detail.open("uuid-1");
    detail.close();

    expect(detail.record.value).toBeNull();
    expect(detail.loadError.value).toBeNull();
    expect(detail.isLoading.value).toBe(false);
  });

  it("drops a response that lands after close", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const detail = useRecordDetail();
    const pending = detail.open("uuid-1");
    detail.close();
    resolveFetch({ data: makeRecord() });
    await pending;

    expect(detail.record.value).toBeNull();
    expect(detail.isLoading.value).toBe(false);
  });

  describe("applyUpdate", () => {
    it("replaces the open record when the uuid matches", async () => {
      const record = makeRecord();
      mockFetch.mockResolvedValue({ data: record });

      const detail = useRecordDetail();
      await detail.open("uuid-1");

      const updated = makeRecord({ status: "pending", errorMessage: null });
      detail.applyUpdate(updated);

      expect(detail.record.value).toEqual(updated);
    });

    it("ignores an update for a different uuid than the one currently open", async () => {
      const record = makeRecord();
      mockFetch.mockResolvedValue({ data: record });

      const detail = useRecordDetail();
      await detail.open("uuid-1");

      const otherRecord = makeRecord({ uuid: "uuid-2" });
      detail.applyUpdate(otherRecord);

      expect(detail.record.value).toEqual(record);
    });

    it("ignores an update when no record is open", () => {
      const detail = useRecordDetail();
      detail.applyUpdate(makeRecord());

      expect(detail.record.value).toBeNull();
    });
  });
});
