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
  function stubEventLookup(rows: unknown[]) {
    const limit = vi.fn(() => Promise.resolve(rows));
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    selectMock.mockReturnValue({ from });
    return { from, where, limit };
  }

  beforeEach(() => {
    insertMock.mockReset();
    selectMock.mockReset();
    maybePruneEventsForUserMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the event when no event of that kind exists for the record", async () => {
    stubEventLookup([]);
    const valuesMock = vi.fn(() => Promise.resolve());
    insertMock.mockReturnValue({ values: valuesMock });

    await writeEventOncePerRecord({
      userId: "user_abc",
      kind: "ok",
      message: "Webhook received: Deploy",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });

    expect(insertMock).toHaveBeenCalledOnce();
    expect(valuesMock).toHaveBeenCalledWith({
      userId: "user_abc",
      kind: "ok",
      message: "Webhook received: Deploy",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });
  });

  it("skips the write when an event of that kind already exists for the record", async () => {
    stubEventLookup([{ id: "existing-event" }]);
    const valuesMock = vi.fn(() => Promise.resolve());
    insertMock.mockReturnValue({ values: valuesMock });

    await writeEventOncePerRecord({
      userId: "user_abc",
      kind: "ok",
      message: "Webhook received: Deploy",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });

    expect(insertMock).not.toHaveBeenCalled();
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it("fails closed — skips the write when the existence check itself throws, and does not reject", async () => {
    // The read and the follow-up write share a connection, so a transient read
    // failure hits both. Skipping the write (rather than attempting it and
    // rejecting into the caller's error path, which flips a healthy record to
    // error) risks only a missing event, never corruption.
    const limit = vi.fn(() => Promise.reject(new Error("read blip")));
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    selectMock.mockReturnValue({ from });
    const valuesMock = vi.fn(() => Promise.resolve());
    insertMock.mockReturnValue({ values: valuesMock });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      writeEventOncePerRecord({
        userId: "user_abc",
        kind: "ok",
        message: "Webhook received: Deploy",
        recordUuid: "rec-uuid",
        sourceId: "src-uuid",
      }),
    ).resolves.toBeUndefined();

    // No write is attempted, so nothing can reject into the record-error path.
    expect(insertMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[eventWriter]"),
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it("scopes the existence check to the record uuid and the event kind", async () => {
    const { where } = stubEventLookup([]);
    insertMock.mockReturnValue({ values: vi.fn(() => Promise.resolve()) });

    await writeEventOncePerRecord({
      userId: "user_abc",
      kind: "ok",
      message: "Webhook received: Deploy",
      recordUuid: "rec-uuid",
    });

    const whereArg = where.mock.calls[0]?.[0] as {
      conditions: Array<{ value: unknown }>;
    };
    expect(whereArg.conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "rec-uuid" }),
        expect.objectContaining({ value: "ok" }),
      ]),
    );
  });
});
