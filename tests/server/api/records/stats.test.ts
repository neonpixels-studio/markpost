import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import {
  startOfMonthIso,
  startOfTodayIso,
} from "../../../../server/utils/statsBoundaries";

const selectMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ conditions }),
  count: (expr?: unknown) => ({ count: expr }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  gte: (column: unknown, value: unknown) => ({ column, value }),
  isNotNull: (column: unknown) => ({ isNotNull: column }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
    { raw: (str: string) => str },
  ),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const handler = (await import("../../../../server/api/records/stats.get"))
  .default;

const userId = "user_abc123";

function buildEvent(
  contextUserId: string | undefined,
  query: Record<string, unknown> = {},
): H3Event {
  return { context: { userId: contextUserId }, query } as unknown as H3Event;
}

function stubSelectResult(row: Record<string, unknown>) {
  const where = vi.fn(() => Promise.resolve([row]));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("getQuery", (event: { query?: Record<string, unknown> }) => {
    return event.query ?? {};
  });
  mockCreateError.mockClear();
  selectMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/records/stats", () => {
  it("returns stats with numeric counts from the database row", async () => {
    stubSelectResult({
      syncedToday: 5,
      pending: 2,
      errors: 1,
      thisMonth: 42,
    });

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: {
        syncedToday: 5,
        pending: 2,
        errors: 1,
        thisMonth: 42,
      },
    });
  });

  it("returns zeros when the database row contains nulls", async () => {
    stubSelectResult({
      syncedToday: null,
      pending: null,
      errors: null,
      thisMonth: null,
    });

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: {
        syncedToday: 0,
        pending: 0,
        errors: 0,
        thisMonth: 0,
      },
    });
  });

  it("returns zeros when the database returns no rows", async () => {
    const where = vi.fn(() => Promise.resolve([]));
    const from = vi.fn(() => ({ where }));
    selectMock.mockReturnValue({ from });

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: {
        syncedToday: 0,
        pending: 0,
        errors: 0,
        thisMonth: 0,
      },
    });
  });

  it("throws 401 when the user is not authenticated", async () => {
    await expect(handler(buildEvent(undefined))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 401,
      data: {
        errors: [
          expect.objectContaining({ status: "401", title: "Unauthorized" }),
        ],
      },
    });
  });

  it("buckets counts against boundaries derived from the tz query param", async () => {
    const { from } = stubSelectResult({
      syncedToday: 1,
      pending: 0,
      errors: 0,
      thisMonth: 1,
    });

    const timeZone = "America/New_York";
    await handler(buildEvent(userId, { tz: timeZone }));

    const selectColumns = selectMock.mock.calls[0][0] as {
      syncedToday: { count: { values: { value: string }[] } };
      thisMonth: { count: { values: { value: string }[] } };
    };
    const todayBoundary = selectColumns.syncedToday.count.values[1].value;
    const monthBoundary = selectColumns.thisMonth.count.values[0].value;

    expect(todayBoundary).toBe(startOfTodayIso(timeZone));
    expect(monthBoundary).toBe(startOfMonthIso(timeZone));
    // The New York boundary is offset from UTC, so it must not equal the naive
    // UTC start-of-day the endpoint used before the fix.
    expect(todayBoundary).not.toBe(startOfTodayIso("UTC"));
    expect(from).toHaveBeenCalledWith(expect.anything());
  });

  it("falls back to UTC boundaries when no tz query param is present", async () => {
    stubSelectResult({ syncedToday: 0, pending: 0, errors: 0, thisMonth: 0 });

    await handler(buildEvent(userId));

    const selectColumns = selectMock.mock.calls[0][0] as {
      syncedToday: { count: { values: { value: string }[] } };
    };
    const todayBoundary = selectColumns.syncedToday.count.values[1].value;

    expect(todayBoundary).toBe(startOfTodayIso("UTC"));
  });

  it("coerces string counts from the database to numbers", async () => {
    stubSelectResult({
      syncedToday: "3",
      pending: "0",
      errors: "2",
      thisMonth: "99",
    });

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: {
        syncedToday: 3,
        pending: 0,
        errors: 2,
        thisMonth: 99,
      },
    });
  });
});
