import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_PRUNE_BATCH_SIZE,
  EVENT_PRUNE_PROBABILITY,
  maybePruneEventsForUser,
  pruneEventsForUser,
  retentionCutoff,
  shouldPrune,
} from "../../../server/utils/eventRetention";

const selectMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ select: selectMock, delete: deleteMock }),
}));

// Stub the query-builder operators so the test can assert exactly which column
// and operator each predicate targets — a plain `where()` call assertion would
// let `lt` → `gt` or a wrong column (unrecoverable data loss) slip through.
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
  lt: (column: unknown, value: unknown) => ({ op: "lt", column, value }),
  inArray: (column: unknown, values: unknown) => ({
    op: "inArray",
    column,
    values,
  }),
}));

vi.mock("../../../server/db/schema", () => ({
  events: { id: "events.id", userId: "events.userId", ts: "events.ts" },
}));

const userId = "user_abc123";
const SUBQUERY = "expired-ids-subquery";

function stubSelect() {
  const limit = vi.fn(() => SUBQUERY);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where, orderBy, limit };
}

function stubDelete(rowCount: number) {
  const where = vi.fn(() => Promise.resolve({ rowCount }));
  deleteMock.mockReturnValue({ where });
  return { where };
}

beforeEach(() => {
  selectMock.mockReset();
  deleteMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("retentionCutoff", () => {
  it("subtracts the 90-day retention window from now", () => {
    const cutoff = retentionCutoff(new Date("2026-08-13T00:00:00.000Z"));

    expect(cutoff.toISOString()).toBe("2026-05-15T00:00:00.000Z");
  });
});

describe("shouldPrune", () => {
  it("prunes when the sample is below the probability", () => {
    expect(shouldPrune(EVENT_PRUNE_PROBABILITY / 2)).toBe(true);
  });

  it("does not prune when the sample is at or above the probability", () => {
    expect(shouldPrune(EVENT_PRUNE_PROBABILITY)).toBe(false);
    expect(shouldPrune(0.99)).toBe(false);
  });
});

describe("pruneEventsForUser", () => {
  it("selects only this user's rows older than the cutoff, oldest first, bounded by the batch size", async () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    const { where: selectWhere, orderBy, limit } = stubSelect();
    stubDelete(1);

    await pruneEventsForUser(userId, now);

    expect(selectWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", column: "events.userId", value: userId },
        { op: "lt", column: "events.ts", value: retentionCutoff(now) },
      ],
    });
    expect(orderBy).toHaveBeenCalledWith("events.ts");
    expect(limit).toHaveBeenCalledWith(EVENT_PRUNE_BATCH_SIZE);
  });

  it("scopes the delete to the user and the selected ids, returning the affected-row count", async () => {
    stubSelect();
    const { where: deleteWhere } = stubDelete(2);

    const deleted = await pruneEventsForUser(userId, new Date());

    expect(deleteWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", column: "events.userId", value: userId },
        { op: "inArray", column: "events.id", values: SUBQUERY },
      ],
    });
    expect(deleted).toBe(2);
  });

  it("returns zero when the driver reports no affected rows", async () => {
    stubSelect();
    deleteMock.mockReturnValue({
      where: vi.fn(() => Promise.resolve({ rowCount: null })),
    });

    const deleted = await pruneEventsForUser(userId, new Date());

    expect(deleted).toBe(0);
  });
});

describe("maybePruneEventsForUser", () => {
  it("prunes when the random draw falls below the probability", async () => {
    vi.spyOn(Math, "random").mockReturnValue(EVENT_PRUNE_PROBABILITY / 2);
    stubSelect();
    stubDelete(1);

    await maybePruneEventsForUser(userId);

    expect(deleteMock).toHaveBeenCalledOnce();
  });

  it("skips pruning when the random draw is above the probability", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    await maybePruneEventsForUser(userId);

    expect(selectMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("swallows and logs prune failures so the triggering write is never broken", async () => {
    vi.spyOn(Math, "random").mockReturnValue(EVENT_PRUNE_PROBABILITY / 2);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    selectMock.mockImplementation(() => {
      throw new Error("db down");
    });

    await expect(maybePruneEventsForUser(userId)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      `[eventRetention] failed to prune events for user ${userId}:`,
      expect.any(Error),
    );
  });
});
