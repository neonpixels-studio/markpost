import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAST_USED_AT_THROTTLE_MS,
  isLastUsedAtStale,
  refreshTokenLastUsedAt,
} from "../../../server/utils/tokenUsage";

const updateMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ update: updateMock }),
}));

// Stub the query-builder operator so the test can assert exactly which column
// the predicate targets — a plain `where()` assertion would let a wrong column
// (updating every token's lastUsedAt) slip through.
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
}));

vi.mock("../../../server/db/schema", () => ({
  apiTokens: { id: "apiTokens.id", lastUsedAt: "apiTokens.lastUsedAt" },
}));

const tokenId = "token-uuid-1";
const now = new Date("2026-08-20T12:00:00.000Z");

function stubUpdateSuccess() {
  const where = vi.fn(() => Promise.resolve());
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
  return { set, where };
}

beforeEach(() => {
  updateMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isLastUsedAtStale", () => {
  it("treats a null lastUsedAt as stale (never recorded)", () => {
    expect(isLastUsedAtStale(null, now)).toBe(true);
  });

  it("treats an undefined lastUsedAt as stale", () => {
    expect(isLastUsedAtStale(undefined, now)).toBe(true);
  });

  it("is stale when the last write is older than the throttle interval", () => {
    const stale = new Date(now.getTime() - LAST_USED_AT_THROTTLE_MS - 1);
    expect(isLastUsedAtStale(stale, now)).toBe(true);
  });

  it("is stale exactly at the throttle boundary", () => {
    const boundary = new Date(now.getTime() - LAST_USED_AT_THROTTLE_MS);
    expect(isLastUsedAtStale(boundary, now)).toBe(true);
  });

  it("is fresh when the last write is within the throttle interval", () => {
    const fresh = new Date(now.getTime() - LAST_USED_AT_THROTTLE_MS + 1);
    expect(isLastUsedAtStale(fresh, now)).toBe(false);
  });
});

describe("refreshTokenLastUsedAt", () => {
  it("writes when lastUsedAt has never been recorded", async () => {
    const stubs = stubUpdateSuccess();

    await refreshTokenLastUsedAt(tokenId, null, now);

    expect(updateMock).toHaveBeenCalledOnce();
    expect(stubs.set).toHaveBeenCalledWith({ lastUsedAt: now });
    expect(stubs.where).toHaveBeenCalledWith({
      op: "eq",
      column: "apiTokens.id",
      value: tokenId,
    });
  });

  it("writes when the stored lastUsedAt is stale", async () => {
    stubUpdateSuccess();
    const stale = new Date(now.getTime() - LAST_USED_AT_THROTTLE_MS - 1);

    await refreshTokenLastUsedAt(tokenId, stale, now);

    expect(updateMock).toHaveBeenCalledOnce();
  });

  it("skips the write when the stored lastUsedAt is still fresh", async () => {
    stubUpdateSuccess();
    const fresh = new Date(now.getTime() - LAST_USED_AT_THROTTLE_MS + 1);

    await refreshTokenLastUsedAt(tokenId, fresh, now);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("never throws when the update fails, so it cannot break the request", async () => {
    const where = vi.fn(() => Promise.reject(new Error("db error")));
    const set = vi.fn(() => ({ where }));
    updateMock.mockReturnValue({ set });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      refreshTokenLastUsedAt(tokenId, null, now),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
