import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  validateEventKind,
  writeEvent,
  writeEventOncePerRecord,
} from "../../../server/utils/eventWriter";

const insertMock = vi.fn();
const selectMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ insert: insertMock, select: selectMock }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  // eventWriter.ts tags the ON CONFLICT partial-index predicate with `sql`;
  // stub it as a passthrough so the tagged template just captures its parts
  // instead of needing a real drizzle-orm SQL builder in this unit test.
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

// Retention is covered in eventRetention.test.ts; stub it here so writeEvent's
// insert behaviour is asserted in isolation, free of the prune probability.
const maybePruneEventsForUserMock = vi.fn(() => Promise.resolve());
vi.mock("../../../server/utils/eventRetention", () => ({
  maybePruneEventsForUser: (userId: string) =>
    maybePruneEventsForUserMock(userId),
}));

describe("validateEventKind", () => {
  it("accepts ok", () => {
    expect(validateEventKind("ok")).toBe("ok");
  });

  it("accepts dim", () => {
    expect(validateEventKind("dim")).toBe("dim");
  });

  it("accepts warn", () => {
    expect(validateEventKind("warn")).toBe("warn");
  });

  it("accepts err", () => {
    expect(validateEventKind("err")).toBe("err");
  });

  it("throws on an unknown kind", () => {
    expect(() => validateEventKind("unknown")).toThrow(
      'Invalid event kind: "unknown"',
    );
  });

  it("throws on empty string", () => {
    expect(() => validateEventKind("")).toThrow("Invalid event kind");
  });
});

describe("writeEvent", () => {
  beforeEach(() => {
    insertMock.mockReset();
    maybePruneEventsForUserMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts an event row with required fields", async () => {
    const valuesMock = vi.fn(() => Promise.resolve());
    insertMock.mockReturnValue({ values: valuesMock });

    await writeEvent({
      userId: "user_abc",
      kind: "ok",
      message: "Record synced",
    });

    expect(insertMock).toHaveBeenCalledOnce();
    expect(valuesMock).toHaveBeenCalledWith({
      userId: "user_abc",
      kind: "ok",
      message: "Record synced",
      recordUuid: null,
      sourceId: null,
    });
    expect(maybePruneEventsForUserMock).toHaveBeenCalledWith("user_abc");
  });

  it("inserts an event row with optional recordUuid and sourceId", async () => {
    const valuesMock = vi.fn(() => Promise.resolve());
    insertMock.mockReturnValue({ values: valuesMock });

    await writeEvent({
      userId: "user_abc",
      kind: "warn",
      message: "Sync conflict",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });

    expect(valuesMock).toHaveBeenCalledWith({
      userId: "user_abc",
      kind: "warn",
      message: "Sync conflict",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });
  });

  it("coerces undefined recordUuid and sourceId to null", async () => {
    const valuesMock = vi.fn(() => Promise.resolve());
    insertMock.mockReturnValue({ values: valuesMock });

    await writeEvent({
      userId: "user_abc",
      kind: "dim",
      message: "Deleted 3 records",
      recordUuid: undefined,
      sourceId: undefined,
    });

    const insertedValues = (
      valuesMock.mock.calls[0] as [Record<string, unknown>]
    )[0];

    expect(insertedValues.recordUuid).toBeNull();
    expect(insertedValues.sourceId).toBeNull();
  });
});

describe("writeEventOncePerRecord", () => {
  // Chains insert().values().onConflictDoNothing().returning() the way the
  // real drizzle query builder does, so each mock stage can be asserted
  // individually. `returningRows` stands in for what the DB would actually
  // return: a row on a genuine insert, an empty array when the partial unique
  // index on (record_uuid, kind) absorbed a duplicate via onConflictDoNothing.
  function stubInsert(returningRows: unknown[]) {
    const returning = vi.fn(() => Promise.resolve(returningRows));
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    insertMock.mockReturnValue({ values });
    return { values, onConflictDoNothing, returning };
  }

  beforeEach(() => {
    insertMock.mockReset();
    selectMock.mockReset();
    maybePruneEventsForUserMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the event when it is the first of its kind for the record", async () => {
    const { values, onConflictDoNothing, returning } = stubInsert([
      { id: "new-event" },
    ]);

    await writeEventOncePerRecord({
      userId: "user_abc",
      kind: "ok",
      message: "Webhook received: Deploy",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });

    expect(insertMock).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith({
      userId: "user_abc",
      kind: "ok",
      message: "Webhook received: Deploy",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
    expect(returning).toHaveBeenCalledOnce();
    expect(maybePruneEventsForUserMock).toHaveBeenCalledWith("user_abc");
  });

  it("targets the partial unique index on (record_uuid, kind)", async () => {
    const { onConflictDoNothing } = stubInsert([{ id: "new-event" }]);

    await writeEventOncePerRecord({
      userId: "user_abc",
      kind: "err",
      message: "Failed to confirm webhook ingestion",
      recordUuid: "rec-uuid",
    });

    const config = onConflictDoNothing.mock.calls[0]?.[0] as {
      target: unknown[];
      where: unknown;
    };
    expect(config.target).toHaveLength(2);
    expect(config.where).toBeDefined();
  });

  it("is a no-op when a duplicate (record_uuid, kind) insert is absorbed by the DB-level unique index", async () => {
    // returning() resolving empty mirrors onConflictDoNothing actually firing
    // at the DB layer for a concurrent duplicate — this is what makes the
    // dedup exact instead of check-then-act.
    const { returning } = stubInsert([]);

    await expect(
      writeEventOncePerRecord({
        userId: "user_abc",
        kind: "ok",
        message: "Webhook received: Deploy",
        recordUuid: "rec-uuid",
        sourceId: "src-uuid",
      }),
    ).resolves.toBeUndefined();

    expect(returning).toHaveBeenCalledOnce();
    expect(maybePruneEventsForUserMock).not.toHaveBeenCalled();
  });

  it("rejects a kind outside ok/err, since the partial index does not cover it", async () => {
    stubInsert([{ id: "new-event" }]);

    await expect(
      writeEventOncePerRecord({
        userId: "user_abc",
        kind: "warn",
        message: "Sync conflict",
        recordUuid: "rec-uuid",
      }),
    ).rejects.toThrow("writeEventOncePerRecord only supports kinds: ok, err");

    expect(insertMock).not.toHaveBeenCalled();
  });
});
