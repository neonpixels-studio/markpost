import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const updateMock = vi.fn();
const writeEventMock = vi.fn(() => Promise.resolve());

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ update: updateMock }),
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

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readBody", mockReadBody);
  mockCreateError.mockClear();
  mockReadBody.mockReset();
  updateMock.mockReset();
  writeEventMock.mockClear();
  setCalls.length = 0;
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
            syncedAt: "2024-01-16T10:00:00.000Z",
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

    it("parses syncedAt into a Date and passes distinct payloads per record", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([
          {
            uuid: uuidOne,
            status: "synced",
            syncedAt: "2024-01-16T10:00:00.000Z",
            filePath: "a.md",
          },
          { uuid: uuidTwo, syncedAt: null },
        ]),
      );
      stubUpdates([
        [{ ...baseRecord(uuidOne), status: "synced" }],
        [{ ...baseRecord(uuidTwo) }],
      ]);

      await handler(buildEvent(userId));

      expect(setCalls[0]).toEqual({
        status: "synced",
        syncedAt: new Date("2024-01-16T10:00:00.000Z"),
        filePath: "a.md",
      });
      expect(setCalls[1]).toEqual({ syncedAt: null });
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

    it("throws 422 when syncedAt is the wrong type", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, syncedAt: 1234 }]),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              detail: "SyncedAt must be a date string or null",
            }),
          ],
        },
      });
    });

    it("throws 422 when syncedAt is an unparseable date string", async () => {
      mockReadBody.mockResolvedValue(
        buildBody([{ uuid: uuidOne, syncedAt: "not-a-date" }]),
      );

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: {
          errors: [
            expect.objectContaining({
              detail: "SyncedAt must be a valid date string",
            }),
          ],
        },
      });
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
