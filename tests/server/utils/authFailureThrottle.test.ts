import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spyConsoleError } from "../helpers";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  }),
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
// the exact same `authFailureThrottle` object instance authFailureThrottle.ts
// builds its query against.
const { authFailureThrottle } = await import("../../../server/db/schema");

const {
  reserveAuthAttempt,
  refundAuthAttempt,
  throttleKeyForIp,
  AUTH_FAILURE_THROTTLE_MAX_HITS,
  AUTH_FAILURE_THROTTLE_WINDOW_SECONDS,
} = await import("../../../server/utils/authFailureThrottle");

const CLIENT_IP = "203.0.113.10";

function expectedHash(key: string, pepper: string): string {
  return createHmac("sha256", pepper).update(key).digest("hex");
}

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

function stubUpdateSuccess() {
  const where = vi.fn(() => Promise.resolve());
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
  return { set, where };
}

function stubUpdateFailure(error: Error) {
  const where = vi.fn(() => Promise.reject(error));
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
}

function stubDeleteSuccess() {
  const where = vi.fn(() => Promise.resolve());
  deleteMock.mockReturnValue({ where });
  return { where };
}

beforeEach(() => {
  insertMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
  stubDeleteSuccess();
  delete process.env.AUTH_THROTTLE_IP_PEPPER;
  // Deterministic by default: reserveAndFetchCounter's own 1% opportunistic
  // prune trigger would otherwise flake this suite — pin it off here and
  // turn it back on explicitly in the pruning describe block below.
  vi.spyOn(Math, "random").mockReturnValue(1);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("throttleKeyForIp", () => {
  it("passes an IPv4 address through unchanged", () => {
    expect(throttleKeyForIp("203.0.113.10")).toBe("203.0.113.10");
  });

  it("extracts the embedded IPv4 address from an IPv4-mapped IPv6 address", () => {
    expect(throttleKeyForIp("::ffff:203.0.113.10")).toBe("203.0.113.10");
  });

  it("truncates a fully-written IPv6 address to its /64 prefix", () => {
    expect(throttleKeyForIp("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd")).toBe(
      "2001:db8:1234:5678",
    );
  });

  it("truncates a compressed IPv6 address to its /64 prefix", () => {
    expect(throttleKeyForIp("2001:db8:1234:5678::1")).toBe(
      "2001:db8:1234:5678",
    );
  });

  it("keys two addresses in the same /64 identically", () => {
    const first = throttleKeyForIp("2001:db8:1234:5678:1111:2222:3333:4444");
    const second = throttleKeyForIp("2001:db8:1234:5678:5555:6666:7777:8888");
    expect(first).toBe(second);
  });

  it("keys addresses in different /64s differently", () => {
    const first = throttleKeyForIp("2001:db8:1234:5678::1");
    const second = throttleKeyForIp("2001:db8:1234:5679::1");
    expect(first).not.toBe(second);
  });

  it("is case-insensitive", () => {
    expect(throttleKeyForIp("2001:DB8:1234:5678::1")).toBe(
      throttleKeyForIp("2001:db8:1234:5678::1"),
    );
  });

  it("normalizes leading zeros within a group", () => {
    expect(throttleKeyForIp("2001:0db8:1234:5678::1")).toBe(
      throttleKeyForIp("2001:db8:1234:5678::1"),
    );
  });

  it("extracts the embedded IPv4 from the fully-written mapped form (not just the ::ffff: shorthand)", () => {
    expect(throttleKeyForIp("0:0:0:0:0:ffff:203.0.113.10")).toBe(
      "203.0.113.10",
    );
  });

  it("treats the compressed and fully-written mapped forms of the same address as the same key", () => {
    expect(throttleKeyForIp("0:0:0:0:0:ffff:203.0.113.10")).toBe(
      throttleKeyForIp("::ffff:203.0.113.10"),
    );
  });

  it("is case-insensitive for the fully-written mapped form", () => {
    expect(throttleKeyForIp("0:0:0:0:0:FFFF:203.0.113.10")).toBe(
      "203.0.113.10",
    );
  });
});

describe("reserveAuthAttempt IP hashing", () => {
  it("keys the row by an HMAC-SHA256 of the normalized IP, not the raw address", async () => {
    const { values } = stubInsertReturning([
      { count: 1, windowStart: new Date() },
    ]);

    await reserveAuthAttempt(CLIENT_IP);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ ipHash: expectedHash(CLIENT_IP, "") }),
    );
    const insertedValues = values.mock.calls[0][0] as { ipHash: string };
    expect(insertedValues.ipHash).not.toBe(CLIENT_IP);
  });

  it("hashes the same IP identically across calls (so repeated attempts hit one row)", async () => {
    const { values } = stubInsertReturning([
      { count: 1, windowStart: new Date() },
    ]);

    await reserveAuthAttempt(CLIENT_IP);
    await reserveAuthAttempt(CLIENT_IP);

    const [firstCallValues] = values.mock.calls[0];
    const [secondCallValues] = values.mock.calls[1];
    expect((firstCallValues as { ipHash: string }).ipHash).toBe(
      (secondCallValues as { ipHash: string }).ipHash,
    );
  });

  it("hashes two IPv6 addresses in the same /64 to the same row", async () => {
    const { values } = stubInsertReturning([
      { count: 1, windowStart: new Date() },
    ]);

    await reserveAuthAttempt("2001:db8:1234:5678:1111:2222:3333:4444");
    await reserveAuthAttempt("2001:db8:1234:5678:5555:6666:7777:8888");

    const [firstCallValues] = values.mock.calls[0];
    const [secondCallValues] = values.mock.calls[1];
    expect((firstCallValues as { ipHash: string }).ipHash).toBe(
      (secondCallValues as { ipHash: string }).ipHash,
    );
  });

  it("mixes AUTH_THROTTLE_IP_PEPPER into the hash when set, changing the stored key", async () => {
    process.env.AUTH_THROTTLE_IP_PEPPER = "test-pepper";
    const { values } = stubInsertReturning([
      { count: 1, windowStart: new Date() },
    ]);

    await reserveAuthAttempt(CLIENT_IP);

    const insertedValues = values.mock.calls[0][0] as { ipHash: string };
    expect(insertedValues.ipHash).toBe(expectedHash(CLIENT_IP, "test-pepper"));
    expect(insertedValues.ipHash).not.toBe(expectedHash(CLIENT_IP, ""));
  });
});

describe("reserveAuthAttempt atomic upsert shape", () => {
  it("does not stamp windowStart from the app clock, so a fresh row uses the column default (the database's own now())", async () => {
    const { values } = stubInsertReturning([
      { count: 1, windowStart: new Date() },
    ]);

    await reserveAuthAttempt(CLIENT_IP);

    const insertedValues = values.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedValues).toEqual({ ipHash: expect.any(String), count: 1 });
    expect(insertedValues.windowStart).toBeUndefined();
  });

  it("targets the ipHash column as the conflict arbiter", async () => {
    const { onConflictDoUpdate } = stubInsertReturning([
      { count: 1, windowStart: new Date() },
    ]);

    await reserveAuthAttempt(CLIENT_IP);

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

    await reserveAuthAttempt(CLIENT_IP);

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

describe("reserveAuthAttempt threshold behavior", () => {
  it("allows an attempt under the limit", async () => {
    stubInsertReturning([{ count: 1, windowStart: new Date() }]);

    const result = await reserveAuthAttempt(CLIENT_IP);

    expect(result).toEqual({ allowed: true });
  });

  it("allows an attempt exactly at the limit", async () => {
    stubInsertReturning([
      { count: AUTH_FAILURE_THROTTLE_MAX_HITS, windowStart: new Date() },
    ]);

    const result = await reserveAuthAttempt(CLIENT_IP);

    expect(result).toEqual({ allowed: true });
  });

  it("has enough headroom to absorb a realistic burst of concurrent legitimate requests from one IP", async () => {
    // reserveAuthAttempt spends budget on every attempt, successful or not
    // (see its doc comment) — a plausible concurrent burst from one
    // legitimate API client (e.g. a CLI batch sync) must clear the limit, or
    // this throttle would 429 real traffic instead of only guessing loops.
    const REALISTIC_CONCURRENT_BURST = 20;
    stubInsertReturning([
      { count: REALISTIC_CONCURRENT_BURST, windowStart: new Date() },
    ]);

    const result = await reserveAuthAttempt(CLIENT_IP);

    expect(result).toEqual({ allowed: true });
  });

  it("denies an attempt over the limit and reports retryAfterSeconds", async () => {
    const windowStart = new Date(
      Date.now() - (AUTH_FAILURE_THROTTLE_WINDOW_SECONDS - 15) * 1000,
    );
    stubInsertReturning([
      {
        count: AUTH_FAILURE_THROTTLE_MAX_HITS + 1,
        windowStart,
      },
    ]);

    const result = await reserveAuthAttempt(CLIENT_IP);

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
    const denied = await reserveAuthAttempt(CLIENT_IP);
    expect(denied.allowed).toBe(false);

    stubInsertReturning([{ count: 1, windowStart: new Date() }]);
    const allowed = await reserveAuthAttempt(CLIENT_IP);
    expect(allowed).toEqual({ allowed: true });
  });

  it("fails open and logs when the counter write itself rejects", async () => {
    // A broken limiter must not itself become the reason every login
    // attempt gets blocked. The caller (server/middleware/auth.ts) still
    // runs verification normally either way.
    stubInsertFailure(new Error("connection reset"));
    const consoleErrorSpy = spyConsoleError();

    const result = await reserveAuthAttempt(CLIENT_IP);

    expect(result).toEqual({ allowed: true });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("fails open when getDb() itself throws (e.g. missing connection config)", async () => {
    insertMock.mockImplementation(() => {
      throw new Error("no database connection configured");
    });
    const consoleErrorSpy = spyConsoleError();

    const result = await reserveAuthAttempt(CLIENT_IP);

    expect(result).toEqual({ allowed: true });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("reserveAuthAttempt opportunistic pruning", () => {
  it("does not prune on a typical call (low-probability trigger not hit)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    stubInsertReturning([{ count: 1, windowStart: new Date() }]);

    await reserveAuthAttempt(CLIENT_IP);

    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("prunes expired rows when the low-probability trigger fires", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { where } = stubDeleteSuccess();
    stubInsertReturning([{ count: 1, windowStart: new Date() }]);

    await reserveAuthAttempt(CLIENT_IP);

    expect(deleteMock).toHaveBeenCalledWith(authFailureThrottle);
    const condition = where.mock.calls[0][0] as SqlFragment;
    expect(condition.strings.join("<expr>")).toBe(
      "(now() - <expr>) >= (<expr> * interval '1 second')",
    );
    expect(condition.values).toEqual([
      authFailureThrottle.windowStart,
      AUTH_FAILURE_THROTTLE_WINDOW_SECONDS,
    ]);
  });

  it("swallows a pruning failure without affecting the throttle result", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const where = vi.fn(() => Promise.reject(new Error("prune failed")));
    deleteMock.mockReturnValue({ where });
    stubInsertReturning([{ count: 1, windowStart: new Date() }]);
    const consoleErrorSpy = spyConsoleError();

    const result = await reserveAuthAttempt(CLIENT_IP);

    expect(result).toEqual({ allowed: true });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("refundAuthAttempt", () => {
  it("decrements the count for the same hash reserveAuthAttempt writes under", async () => {
    const { set, where } = stubUpdateSuccess();

    await refundAuthAttempt(CLIENT_IP);

    expect(updateMock).toHaveBeenCalledWith(authFailureThrottle);
    expect(set).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledWith({
      column: authFailureThrottle.ipHash,
      value: expectedHash(CLIENT_IP, ""),
    });
  });

  it("floors the decrement at 0 via GREATEST, so it can never go negative", async () => {
    const { set } = stubUpdateSuccess();

    await refundAuthAttempt(CLIENT_IP);

    const setArgument = set.mock.calls[0][0] as { count: SqlFragment };
    expect(setArgument.count.strings.join("<expr>")).toBe(
      "GREATEST(<expr> - 1, 0)",
    );
    expect(setArgument.count.values).toEqual([authFailureThrottle.count]);
  });

  it("swallows a write failure without throwing", async () => {
    stubUpdateFailure(new Error("connection reset"));
    const consoleErrorSpy = spyConsoleError();

    await expect(refundAuthAttempt(CLIENT_IP)).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("swallows a getDb() failure without throwing", async () => {
    updateMock.mockImplementation(() => {
      throw new Error("no database connection configured");
    });
    const consoleErrorSpy = spyConsoleError();

    await expect(refundAuthAttempt(CLIENT_IP)).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
