import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockCreateError } from "../helpers";

const updateMock = vi.fn();
const mockCreateError = createMockCreateError();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ update: updateMock }),
}));

type SqlFragment = { strings: readonly string[]; values: unknown[] };

function isSqlFragment(value: unknown): value is SqlFragment {
  return (
    typeof value === "object" &&
    value !== null &&
    "strings" in value &&
    "values" in value
  );
}

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

// Left unmocked (only `../db` and `drizzle-orm` are mocked above) so this is
// the exact same `users` object instance apiThrottle.ts builds its query
// against, matching the reference-identity assertions in
// webhookThrottle.test.ts.
const { users } = await import("../../../server/db/schema");

const {
  recordAuthedApiHit,
  API_THROTTLE_MAX_HITS,
  API_THROTTLE_WINDOW_SECONDS,
} = await import("../../../server/utils/apiThrottle");

const USER_ID = "user_abc123";

function stubUpdateReturning(rows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
  return { set, where, returning };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  mockCreateError.mockClear();
  updateMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("recordAuthedApiHit atomic update shape", () => {
  it("targets the row for the given userId, not some other column", async () => {
    const { where } = stubUpdateReturning([
      { apiThrottleCount: 1, apiThrottleWindowStart: new Date() },
    ]);

    await recordAuthedApiHit(USER_ID);

    expect(where).toHaveBeenCalledWith({
      column: users.userId,
      value: USER_ID,
    });
  });

  it("builds a CASE expression that resets on an expired window and otherwise increments", async () => {
    const { set } = stubUpdateReturning([
      { apiThrottleCount: 1, apiThrottleWindowStart: new Date() },
    ]);

    await recordAuthedApiHit(USER_ID);

    expect(set).toHaveBeenCalledOnce();
    const setArgument = set.mock.calls[0][0] as {
      apiThrottleWindowStart: SqlFragment;
      apiThrottleCount: SqlFragment;
    };

    expect(setArgument.apiThrottleWindowStart.strings.join("<expr>")).toBe(
      "CASE WHEN <expr> THEN now() ELSE <expr> END",
    );
    expect(setArgument.apiThrottleCount.strings.join("<expr>")).toBe(
      "CASE WHEN <expr> THEN 1 ELSE <expr> + 1 END",
    );

    const [windowStartCondition, windowStartElseValue] =
      setArgument.apiThrottleWindowStart.values;
    const [countCondition, countElseValue] =
      setArgument.apiThrottleCount.values;

    // The ELSE branch of each CASE must read back its own column (preserve
    // the window / increment the existing count), not some other column.
    expect(windowStartElseValue).toBe(users.apiThrottleWindowStart);
    expect(countElseValue).toBe(users.apiThrottleCount);

    // Both CASE expressions must gate on the exact same shared condition, so
    // the window can never reset in one column but not the other.
    expect(isSqlFragment(windowStartCondition)).toBe(true);
    expect(windowStartCondition).toBe(countCondition);

    if (!isSqlFragment(windowStartCondition)) {
      throw new Error("expected windowExpired to be a sql fragment");
    }

    expect(windowStartCondition.strings.join("<expr>")).toBe(
      "(now() - <expr>) >= (<expr> * interval '1 second')",
    );
    expect(windowStartCondition.values).toEqual([
      users.apiThrottleWindowStart,
      API_THROTTLE_WINDOW_SECONDS,
    ]);
  });
});

describe("recordAuthedApiHit", () => {
  it("allows a hit under the limit", async () => {
    stubUpdateReturning([
      { apiThrottleCount: 1, apiThrottleWindowStart: new Date() },
    ]);

    const result = await recordAuthedApiHit(USER_ID);

    expect(result).toEqual({ allowed: true });
  });

  it("allows a hit exactly at the limit", async () => {
    stubUpdateReturning([
      {
        apiThrottleCount: API_THROTTLE_MAX_HITS,
        apiThrottleWindowStart: new Date(),
      },
    ]);

    const result = await recordAuthedApiHit(USER_ID);

    expect(result).toEqual({ allowed: true });
  });

  it("denies a hit over the limit and reports retryAfterSeconds", async () => {
    const windowStart = new Date(
      Date.now() - (API_THROTTLE_WINDOW_SECONDS - 10) * 1000,
    );
    stubUpdateReturning([
      {
        apiThrottleCount: API_THROTTLE_MAX_HITS + 1,
        apiThrottleWindowStart: windowStart,
      },
    ]);

    const result = await recordAuthedApiHit(USER_ID);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(11);
    }
  });

  it("resets after the window: a fresh window (count 1) is allowed again", async () => {
    stubUpdateReturning([
      {
        apiThrottleCount: API_THROTTLE_MAX_HITS + 1,
        apiThrottleWindowStart: new Date(),
      },
    ]);
    const denied = await recordAuthedApiHit(USER_ID);
    expect(denied.allowed).toBe(false);

    stubUpdateReturning([
      { apiThrottleCount: 1, apiThrottleWindowStart: new Date() },
    ]);
    const allowed = await recordAuthedApiHit(USER_ID);
    expect(allowed).toEqual({ allowed: true });
  });

  it("fails closed with a 401 when the user row is not found", async () => {
    // Unlike webhookThrottle's "no row -> allow" fallback (a deleted source's
    // own 404 takes over downstream), nothing downstream catches a missing
    // users row here, so this must not silently hand out an unthrottled
    // request. See the comment on recordAuthedApiHit.
    stubUpdateReturning([]);

    await expect(recordAuthedApiHit(USER_ID)).rejects.toThrow();

    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });
});
