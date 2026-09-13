import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const updateMock = vi.fn();
const selectMock = vi.fn();
const writeEventMock = vi.fn(() => Promise.resolve());

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ update: updateMock, select: selectMock }),
}));

vi.mock("../../../../server/utils/eventWriter", () => ({
  writeEvent: writeEventMock,
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockReadBody = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } =
  await import("../../../../server/api/records/index.patch");

const userId = "user_abc123";
const uuidOne = "550e8400-e29b-41d4-a716-446655440001";
const uuidTwo = "550e8400-e29b-41d4-a716-446655440002";
const uuidThree = "550e8400-e29b-41d4-a716-446655440003";

function baseRecord(uuid: string) {
  return {
    uuid,
    userId,
    createdAt: new Date("2024-01-15T10:00:00Z"),
    title: "My Note",
    content: "Some content",
    sourceId: null,
    source: null,
    status: "pending",
    filePath: null,
    tags: null,
    frontmatter: null,
    syncedAt: null,
    errorMessage: null,
  };
}

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function buildBody(records: unknown) {
  return { data: { type: "records", attributes: { records } } };
}

const setCalls: unknown[] = [];

// Each applyUpdate runs `db.update().set().where().returning()` synchronously up
// to the returning() promise, so update() is invoked in input order and the
// per-call result queue lines up with the records array the handler received.
function stubUpdates(rowsPerCall: unknown[][]) {
  let call = 0;
  updateMock.mockImplementation(() => {
    const index = call;
    call += 1;
    const set = vi.fn((payload: unknown) => {
      setCalls.push(payload);
      const returning = vi.fn(() => Promise.resolve(rowsPerCall[index] ?? []));
      const where = vi.fn(() => ({ returning }));
      return { where };
    });
    return { set };
  });
}

// The handler issues up to two db.select() calls in a fixed order: first
// resolveAlreadySyncedUuids (skipped entirely when no item in the batch
// changes status), then resolveSourceTypes. Queue-based like stubUpdates so a
// test can give each call its own result instead of one static return shared
// by both — `results[N]` may be a plain row array or a thunk (for rejection).
function stubSelects(results: (unknown[] | (() => Promise<unknown[]>))[]) {
  let call = 0;
  selectMock.mockImplementation(() => {
    const index = call;
    call += 1;
    const resultOrThunk = results[index] ?? [];
    const where = vi.fn(() =>
      typeof resultOrThunk === "function"
        ? resultOrThunk()
        : Promise.resolve(resultOrThunk),
    );
    const from = vi.fn(() => ({ where }));
    return { from };
  });
}

// Convenience for tests that only care about the sourceType lookup: the
// already-synced-uuids call (if any) resolves empty (unknown uuids are
// treated as not-yet-synced, which doesn't affect these sourceType-focused
// tests).
function stubSourceTypeResult(rows: unknown[]) {
  stubSelects([[], rows]);
}

function syncedAtRow(uuid: string, syncedAt: Date | null) {
  return { uuid, syncedAt };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readBody", mockReadBody);
  mockCreateError.mockClear();
  mockReadBody.mockReset();
  updateMock.mockReset();
  selectMock.mockReset();
  writeEventMock.mockClear();
  setCalls.length = 0;
  stubSelects([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PATCH /api/records (bulk)", () => {
  describe("successful updates", () => {
    it("updates every record and returns the serialized rows with a count", async () => {
      const first = {
        ...baseRecord(uuidOne),
        status: "synced",
        syncedAt: new Date("2024-01-16T10:00:00.000Z"),
        filePath: "05-stripe/a.md",
      };
      const second = {
        ...baseRecord(uuidTwo),
        status: "error",
        errorMessage: "boom",
      };
      mockReadBody.mockResolvedValue(
        buildBody([
          {
            uuid: uuidOne,
            status: "synced",
            filePath: "05-stripe/a.md",
          },
          { uuid: uuidTwo, status: "error", errorMessage: "boom" },
        ]),
      );
      stubUpdates([[first], [second]]);

      const response = await handler(buildEvent(userId));

      expect(response.meta).toEqual({ updated: 2 });
      expect(response.data).toHaveLength(2);
      expect(response.data?.[0]?.id).toBe(uuidOne);
      expect(response.data?.[1]?.attributes.errorMessage).toBe("boom");
    });

    it("resolves sourceType per record in a single batched lookup", async () => {
      const sourceIdOne = "550e8400-e29b-41d4-a716-446655440091";
      const sourceIdTwo = "550e8400-e29b-41d4-a716-446655440092";
      mockReadBody.mockResolvedValue(
        buildBody([
          { uuid: uuidOne, status: "synced" },
          { uuid: uuidTwo, status: "synced" },
        ]),
      );
      stubUpdates([
        [{ ...baseRecord(uuidOne), sourceId: sourceIdOne }],
        [{ ...baseRecord(uuidTwo), sourceId: sourceIdTwo }],
      ]);
      // Call 1: resolveCurrentStatuses (both items change status). Call 2:
      // resolveSourceTypes, batched once for the whole response, not once per
      // record.
      stubSelects([
        [],
        [
          { uuid: sourceIdOne, type: "webhook" },
          { uuid: sourceIdTwo, type: "email" },
        ],
      ]);

      const response = await handler(buildEvent(userId));

      expect(selectMock).toHaveBeenCalledTimes(2);
      expect(response.data?.[0]?.attributes.sourceType).toBe("webhook");
      expect(response.data?.[1]?.attributes.sourceType).toBe("email");
    });

    it("returns null sourceType only for the record with no source, in a mixed batch", async () => {
      const sourceIdOne = "550e8400-e29b-41d4-a716-446655440093";
      mockReadBody.mockResolvedValue(
        buildBody([
          { uuid: uuidOne, status: "synced" },
          { uuid: uuidTwo, status: "synced" },
        ]),
      );
      stubUpdates([
        [{ ...baseRecord(uuidOne), sourceId: sourceIdOne }],
        [{ ...baseRecord(uuidTwo), sourceId: null }],
      ]);
      stubSourceTypeResult([{ uuid: sourceIdOne, type: "webhook" }]);

      const response = await handler(buildEvent(userId));

      expect(response.data?.[0]?.attributes.sourceType).toBe("webhook");
      expect(response.data?.[1]?.attributes.sourceType).toBeNull();
    });

    it("returns sourceType: null for every record (never fails the batch) when the type lookup throws", async () => {
      const sourceIdOne = "550e8400-e29b-41d4-a716-446655440094";
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mockReadBody.mockResolvedValue(
        buildBody([
          { uuid: uuidOne, status: "synced" },
          { uuid: uuidTwo, status: "synced" },
        ]),
      );
      stubUpdates([
        [{ ...baseRecord(uuidOne), sourceId: sourceIdOne }],
        [{ ...baseRecord(uuidTwo), sourceId: sourceIdOne }],
      ]);
      // Call 1: resolveCurrentStatuses resolves fine. Call 2: resolveSourceTypes
      // rejects — only the sourceType enrichment should degrade, not the batch.
      stubSelects([[], () => Promise.reject(new Error("connection reset"))]);

      const response = await handler(buildEvent(userId));

      expect(response.meta).toEqual({ updated: 2 });
      expect(response.data?.[0]?.attributes.sourceType).toBeNull();
      expect(response.data?.[1]?.attributes.sourceType).toBeNull();
      consoleErrorSpy.mockRestore();
    });

    it("parses filePath alongside a status change that doesn't move to synced", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([
          {
            uuid: uuidOne,
            status: "error",
            filePath: "a.md",
          },
        ]),
      );
      stubSelects([[syncedAtRow(uuidOne, null)]]);
      stubUpdates([[{ ...baseRecord(uuidOne), status: "error" }]]);

      await handler(buildEvent(userId));

      // syncedAt is never touched for a non-"synced" target status, so
      // there's no syncedAt key in the payload at all.
      expect(setCalls[0]).toEqual({ status: "error", filePath: "a.md" });
    });

    it("counts only records that matched the owner, dropping foreign uuids", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([
          { uuid: uuidOne, status: "synced" },
          { uuid: uuidTwo, status: "synced" },
          { uuid: uuidThree, status: "synced" },
        ]),
      );
      stubUpdates([[{ ...baseRecord(uuidOne), status: "synced" }], [], []]);

      const response = await handler(buildEvent(userId));

      expect(response.meta).toEqual({ updated: 1 });
      expect(response.data).toHaveLength(1);
      expect(writeEventMock).toHaveBeenCalledTimes(1);
    });

    it("does not write an event when nothing matched", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, status: "synced" }]),
      );
      stubUpdates([[]]);

      const response = await handler(buildEvent(userId));

      expect(response.meta).toEqual({ updated: 0 });
      expect(writeEventMock).not.toHaveBeenCalled();
    });
  });

  // Bug: markpost#265. A bulk status change let the client dictate syncedAt
  // outright — re-stamping rows that were already synced (inflating the
  // "synced today" stat) and nulling a real prior syncedAt on any row moved
  // to pending/error, with no way to recover it. The server now derives
  // syncedAt itself from each record's *current* status; the client can no
  // longer supply syncedAt at all (see "rejects any client-supplied syncedAt"
  // below), so these tests only exercise the server-side derivation, which is
  // keyed off whether syncedAt is already set on the row — not off status,
  // since a record can be status "synced" with no syncedAt yet (created that
  // way via POST /api/records).
  describe("syncedAt trust boundary on status changes", () => {
    it("does not re-stamp syncedAt when the record already has one", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, status: "synced" }]),
      );
      stubSelects([[syncedAtRow(uuidOne, new Date("2024-01-01T00:00:00Z"))]]);
      stubUpdates([[{ ...baseRecord(uuidOne), status: "synced" }]]);

      await handler(buildEvent(userId));

      expect(setCalls[0]).toEqual({ status: "synced" });
    });

    it("stamps syncedAt with the current time when a record has never been synced", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-27T12:00:00.000Z"));

      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, status: "synced" }]),
      );
      stubSelects([[syncedAtRow(uuidOne, null)]]);
      stubUpdates([[{ ...baseRecord(uuidOne), status: "synced" }]]);

      await handler(buildEvent(userId));

      expect(setCalls[0]).toEqual({
        status: "synced",
        syncedAt: new Date("2026-06-27T12:00:00.000Z"),
      });

      vi.useRealTimers();
    });

    // Regression case: status alone can't answer "has this ever been
    // synced?" — POST /api/records lets a client create a record already
    // marked "synced" with no syncedAt. Keying the guard off status instead
    // of syncedAt would make such a record permanently unstampable here.
    it("stamps syncedAt even when the record's current status is already synced, as long as syncedAt is null", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, status: "synced" }]),
      );
      stubSelects([[syncedAtRow(uuidOne, null)]]);
      stubUpdates([[{ ...baseRecord(uuidOne), status: "synced" }]]);

      await handler(buildEvent(userId));

      expect(setCalls[0]).toHaveProperty("syncedAt");
      expect((setCalls[0] as { syncedAt: Date }).syncedAt).toBeInstanceOf(Date);
    });

    it("stamps syncedAt when the server has no prior record of the uuid at all", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, status: "synced" }]),
      );
      stubSelects([[]]);
      stubUpdates([[{ ...baseRecord(uuidOne), status: "synced" }]]);

      await handler(buildEvent(userId));

      expect(setCalls[0]).toHaveProperty("syncedAt");
      expect((setCalls[0] as { syncedAt: Date }).syncedAt).toBeInstanceOf(Date);
    });

    it("never nulls syncedAt when moving a previously-synced record to pending", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, status: "pending" }]),
      );
      stubSelects([[syncedAtRow(uuidOne, new Date("2024-01-01T00:00:00Z"))]]);
      stubUpdates([[{ ...baseRecord(uuidOne), status: "pending" }]]);

      await handler(buildEvent(userId));

      expect(setCalls[0]).toEqual({ status: "pending" });
    });

    it("never nulls syncedAt when moving a previously-synced record to error", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([
          {
            uuid: uuidOne,
            status: "error",
            errorMessage: "boom",
          },
        ]),
      );
      stubSelects([[syncedAtRow(uuidOne, new Date("2024-01-01T00:00:00Z"))]]);
      stubUpdates([[{ ...baseRecord(uuidOne), status: "error" }]]);

      await handler(buildEvent(userId));

      expect(setCalls[0]).toEqual({
        status: "error",
        errorMessage: "boom",
      });
    });

    it("resolves already-synced uuids in a single batched lookup for a mixed batch", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([
          { uuid: uuidOne, status: "synced" },
          { uuid: uuidTwo, status: "pending" },
        ]),
      );
      stubSelects([
        [
          syncedAtRow(uuidOne, null),
          syncedAtRow(uuidTwo, new Date("2024-01-01T00:00:00Z")),
        ],
      ]);
      stubUpdates([
        [{ ...baseRecord(uuidOne), status: "synced" }],
        [{ ...baseRecord(uuidTwo), status: "pending" }],
      ]);

      await handler(buildEvent(userId));

      expect(selectMock).toHaveBeenCalledTimes(1);
      expect(setCalls[0]).toHaveProperty("syncedAt");
      expect(setCalls[1]).toEqual({ status: "pending" });
    });

    it("aborts the whole batch, writing nothing, when resolving already-synced uuids fails", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, status: "synced" }]),
      );
      // Unlike the sourceType lookup (display-only enrichment, degrades
      // gracefully), a failed lookup here must not fall back to a guess —
      // guessing "not yet synced" would re-stamp every row and reintroduce
      // the exact stat inflation this fix closes.
      stubSelects([() => Promise.reject(new Error("connection reset"))]);

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 500,
      });
      expect(updateMock).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("validation errors", () => {
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

    it("throws 422 when records is missing", async () => {
      mockReadBody.mockResolvedValue({ data: { attributes: {} } });

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
    });

    it("throws 422 when records is an empty array", async () => {
      mockReadBody.mockResolvedValue(buildBody([]));

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
    });

    it("throws 422 when records is not an array", async () => {
      mockReadBody.mockResolvedValue(buildBody("nope"));

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
    });

    it("throws 422 when records exceeds the batch cap", async () => {
      const tooMany = Array.from({ length: 101 }, (_unused, index) => ({
        uuid: `550e8400-e29b-41d4-a716-4466554${String(index).padStart(5, "0")}`,
        status: "synced",
      }));
      mockReadBody.mockResolvedValue(buildBody(tooMany));

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              detail: "Records must not contain more than 100 items",
            }),
          ],
        },
      });
    });

    it("throws 422 when an item is missing a valid uuid", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ status: "synced" }, { uuid: uuidTwo, status: "synced" }]),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              source: { pointer: "/data/attributes/records/0/uuid" },
            }),
          ],
        },
      });
    });

    it("throws 422 when an item has no updatable fields", async () => {
      mockReadBody.mockResolvedValue(buildBody([{ uuid: uuidOne }]));

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              source: { pointer: "/data/attributes/records/0" },
            }),
          ],
        },
      });
    });

    it("throws 422 when a status value is not recognized", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, status: "archived" }]),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            {
              status: "422",
              title: "Invalid Attribute",
              detail: "Status must be one of: synced, pending, error",
              source: { pointer: "/data/attributes/records/0/status" },
            },
          ],
        },
      });
    });

    // Bug: markpost#265. syncedAt is no longer a client-settable field on this
    // endpoint at all (the server derives it from status transitions — see
    // "syncedAt trust boundary on status changes" above), so any item that
    // includes the key is rejected outright, regardless of its value and
    // regardless of whether the item also changes status. A prior version of
    // this endpoint only guarded syncedAt when paired with a status change,
    // leaving a standalone `{ uuid, syncedAt }` update as an unguarded
    // backdoor around the fix.
    it("throws 422 when a client sends syncedAt alongside a status change", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([
          {
            uuid: uuidOne,
            status: "synced",
            syncedAt: "2099-01-01T00:00:00.000Z",
          },
        ]),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              detail:
                "SyncedAt is derived by the server from status changes and cannot be set directly.",
              source: { pointer: "/data/attributes/records/0/syncedAt" },
            }),
          ],
        },
      });
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("throws 422 when a client sends a standalone syncedAt with no status change", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, syncedAt: null }]),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              detail:
                "SyncedAt is derived by the server from status changes and cannot be set directly.",
            }),
          ],
        },
      });
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("throws 422 when filePath is the wrong type", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, filePath: 42 }]),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              detail: "FilePath must be a string or null",
            }),
          ],
        },
      });
    });

    it("throws 422 when errorMessage is the wrong type", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, errorMessage: 42 }]),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              detail: "ErrorMessage must be a string or null",
            }),
          ],
        },
      });
    });

    it("throws 422 when the same uuid appears twice", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([
          { uuid: uuidOne, status: "synced" },
          { uuid: uuidOne, status: "error" },
        ]),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              detail: `Records must not contain duplicate uuids: ${uuidOne}`,
            }),
          ],
        },
      });
    });

    it("throws 422 when attributes is not an object", async () => {
      mockReadBody.mockResolvedValue({
        data: { type: "records", attributes: "nope" },
      });

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              detail: "Attributes must be an object.",
            }),
          ],
        },
      });
    });

    it("does not touch the database when validation fails", async () => {
      mockReadBody.mockResolvedValue(buildBody([{ uuid: uuidOne }]));

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(updateMock).not.toHaveBeenCalled();
    });
  });
});
