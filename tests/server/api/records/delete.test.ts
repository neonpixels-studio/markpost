import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const deleteMock = vi.fn();
const readBodyMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ delete: deleteMock }),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } =
  await import("../../../../server/api/records/index.delete");

const userId = "user_abc123";
const uuidOne = "550e8400-e29b-41d4-a716-446655440001";
const uuidTwo = "550e8400-e29b-41d4-a716-446655440002";
const uuidThree = "550e8400-e29b-41d4-a716-446655440003";

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function buildBody(uuids: unknown) {
  return { data: { attributes: { uuids } } };
}

function stubDeleteResult(returnedRows: { uuid: string }[]) {
  const returning = vi.fn(() => Promise.resolve(returnedRows));
  const where = vi.fn(() => ({ returning }));
  deleteMock.mockReturnValue({ where });
  return { where, returning };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readBody", readBodyMock);
  mockCreateError.mockClear();
  readBodyMock.mockReset();
  deleteMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DELETE /api/records", () => {
  describe("successful deletions", () => {
    it("returns the count of all deleted records when all UUIDs match the user", async () => {
      readBodyMock.mockResolvedValue(buildBody([uuidOne, uuidTwo]));
      stubDeleteResult([{ uuid: uuidOne }, { uuid: uuidTwo }]);

      const response = await handler(buildEvent(userId));

      expect(response).toEqual({ meta: { deleted: 2 } });
    });

    it("returns the count of only records that existed when some UUIDs are foreign or nonexistent", async () => {
      readBodyMock.mockResolvedValue(buildBody([uuidOne, uuidTwo, uuidThree]));
      stubDeleteResult([{ uuid: uuidOne }]);

      const response = await handler(buildEvent(userId));

      expect(response).toEqual({ meta: { deleted: 1 } });
    });

    it("returns zero when none of the UUIDs match the user", async () => {
      readBodyMock.mockResolvedValue(buildBody([uuidOne, uuidTwo]));
      stubDeleteResult([]);

      const response = await handler(buildEvent(userId));

      expect(response).toEqual({ meta: { deleted: 0 } });
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

    it("throws 422 when uuids is missing from the request body", async () => {
      readBodyMock.mockResolvedValue({ data: { attributes: {} } });

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: { errors: expect.any(Array) },
      });
    });

    it("throws 422 when uuids is an empty array", async () => {
      readBodyMock.mockResolvedValue(buildBody([]));

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: { errors: expect.any(Array) },
      });
    });

    it("throws 422 when uuids is not an array", async () => {
      readBodyMock.mockResolvedValue(buildBody("not-an-array"));

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: { errors: expect.any(Array) },
      });
    });

    it("throws 422 when uuids contains non-string elements", async () => {
      readBodyMock.mockResolvedValue(buildBody([uuidOne, 123, {}]));

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: { errors: expect.any(Array) },
      });
    });

    it("throws 422 when uuids contains malformed UUID strings", async () => {
      readBodyMock.mockResolvedValue(buildBody([uuidOne, "not-a-uuid"]));

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: { errors: expect.any(Array) },
      });
    });

    it("throws 422 when data.attributes is missing entirely", async () => {
      readBodyMock.mockResolvedValue({ data: {} });

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(mockCreateError).toHaveBeenCalledWith({
        statusCode: 422,
        data: { errors: expect.any(Array) },
      });
    });
  });
});
