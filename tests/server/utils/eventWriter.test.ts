import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  validateEventKind,
  writeEvent,
} from "../../../server/utils/eventWriter";

const insertMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ insert: insertMock }),
}));

vi.mock("drizzle-orm", () => ({}));

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
