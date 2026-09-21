import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spyConsoleError } from "../helpers";

const insertMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ insert: insertMock }),
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
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

// Left unmocked (only `../db` and `drizzle-orm` are mocked above) so this is
// the exact same `authFailureThrottle` object instance authFailureThrottle.ts
// builds its query against.
const { authFailureThrottle } = await import("../../../server/db/schema");

const {
  recordAuthFailure,
  AUTH_FAILURE_THROTTLE_MAX_HITS,
  AUTH_FAILURE_THROTTLE_WINDOW_SECONDS,
} = await import("../../../server/utils/authFailureThrottle");

const CLIENT_IP = "203.0.113.10";
const EXPECTED_IP_HASH = createHash("sha256").update(CLIENT_IP).digest("hex");

function stubInsertReturning(rows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(rows));
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  insertMock.mockReturnValue({ values });
  return { values, onConflictDoUpdate, returning };
}

function stubInsertFailure(error: Error) {
  const returning = vi.fn(() => Promise.reject(error));
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  insertMock.mockReturnValue({ values });
}

beforeEach(() => {
  insertMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordAuthFailure IP hashing", () => {
  it("keys the row by a SHA-256 hash of the IP, not the raw address", async () => {
    const { values } = stubInsertReturning([
      { count: 1, windowStart: new Date() },
    ]);

    await recordAuthFailure(CLIENT_IP);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ ipHash: EXPECTED_IP_HASH }),
    );
    const insertedValues = values.mock.calls[0][0] as { ipHash: string };
    expect(insertedValues.ipHash).not.toBe(CLIENT_IP);
  });

  it("hashes the same IP identically across calls (so repeated failures hit one row)", async () => {
    const { values } = stubInsertReturning([
      { count: 1, windowStart: new Date() },
    ]);

    await recordAuthFailure(CLIENT_IP);
    await recordAuthFailure(CLIENT_IP);

    const [firstCallValues] = values.mock.calls[0];
    const [secondCallValues] = values.mock.calls[1];
    expect((firstCallValues as { ipHash: string }).ipHash).toBe(
      (secondCallValues as { ipHash: string }).ipHash,
    );
  });
});

describe("recordAuthFailure atomic upsert shape", () => {
  it("targets the ipHash column as the conflict arbiter", async () => {
    const { onConflictDoUpdate } = stubInsertReturning([
      { count: 1, windowStart: new Date() },
    ]);

    await recordAuthFailure(CLIENT_IP);

    expect(onConflictDoUpdate).toHaveBeenCalledOnce();
    const conflictArgument = onConflictDoUpdate.mock.calls[0][0] as {
      target: unknown;
    };
    expect(conflictArgument.target).toBe(authFailureThrottle.ipHash);
  });

  it("builds a CASE expression that resets on an expired window and otherwise increments", async () => {
    const { onConflictDoUpdate } = stubInsertReturning([
      { count: 1, windowStart: new Date() },
    ]);

    await recordAuthFailure(CLIENT_IP);

    const conflictArgument = onConflictDoUpdate.mock.calls[0][0] as {
      set: {
        windowStart: SqlFragment;
        count: SqlFragment;
      };
    };

    expect(conflictArgument.set.windowStart.strings.join("<expr>")).toBe(
      "CASE WHEN <expr> THEN now() ELSE <expr> END",
    );
    expect(conflictArgument.set.count.strings.join("<expr>")).toBe(
      "CASE WHEN <expr> THEN 1 ELSE <expr> + 1 END",
    );

    const [windowStartCondition, windowStartElseValue] =
      conflictArgument.set.windowStart.values;
    const [countCondition, countElseValue] = conflictArgument.set.count.values;

    expect(windowStartElseValue).toBe(authFailureThrottle.windowStart);
    expect(countElseValue).toBe(authFailureThrottle.count);
    expect(windowStartCondition).toBe(countCondition);

    if (!isSqlFragment(windowStartCondition)) {
      throw new Error("expected windowExpired to be a sql fragment");
    }

    expect(windowStartCondition.strings.join("<expr>")).toBe(
      "(now() - <expr>) >= (<expr> * interval '1 second')",
    );
    expect(windowStartCondition.values).toEqual([
      authFailureThrottle.windowStart,
      AUTH_FAILURE_THROTTLE_WINDOW_SECONDS,
    ]);
  });
});

describe("recordAuthFailure threshold behavior", () => {
  it("allows a failure under the limit", async () => {
    stubInsertReturning([{ count: 1, windowStart: new Date() }]);

    const result = await recordAuthFailure(CLIENT_IP);

    expect(result).toEqual({ allowed: true });
  });

  it("allows a failure exactly at the limit", async () => {
    stubInsertReturning([
      { count: AUTH_FAILURE_THROTTLE_MAX_HITS, windowStart: new Date() },
    ]);

    const result = await recordAuthFailure(CLIENT_IP);

    expect(result).toEqual({ allowed: true });
  });

  it("denies a failure over the limit and reports retryAfterSeconds", async () => {
    const windowStart = new Date(
      Date.now() - (AUTH_FAILURE_THROTTLE_WINDOW_SECONDS - 15) * 1000,
    );
    stubInsertReturning([
      {
        count: AUTH_FAILURE_THROTTLE_MAX_HITS + 1,
        windowStart,
      },
    ]);

    const result = await recordAuthFailure(CLIENT_IP);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(16);
    }
  });

  it("resets after the window: a fresh window (count 1) is allowed again", async () => {
    stubInsertReturning([
      {
        count: AUTH_FAILURE_THROTTLE_MAX_HITS + 1,
        windowStart: new Date(),
      },
    ]);
    const denied = await recordAuthFailure(CLIENT_IP);
    expect(denied.allowed).toBe(false);

    stubInsertReturning([{ count: 1, windowStart: new Date() }]);
    const allowed = await recordAuthFailure(CLIENT_IP);
    expect(allowed).toEqual({ allowed: true });
  });

  it("fails open and logs when the counter write itself rejects", async () => {
    // Mirrors apiThrottle's fail-open contract: a broken limiter must not
    // itself become the reason every failed login gets blocked. The caller
    // (server/middleware/auth.ts) still throws its normal 401 either way.
    stubInsertFailure(new Error("connection reset"));
    const consoleErrorSpy = spyConsoleError();

    const result = await recordAuthFailure(CLIENT_IP);

    expect(result).toEqual({ allowed: true });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
