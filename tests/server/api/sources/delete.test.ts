import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const deleteMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ delete: deleteMock }),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockGetRouterParam = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } =
  await import("../../../../server/api/sources/[uuid].delete");

const userId = "user_abc123";
const validUuid = "550e8400-e29b-41d4-a716-446655440001";

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function stubDeleteResult(returnedRows: { uuid: string }[]) {
  const returning = vi.fn(() => Promise.resolve(returnedRows));
  const where = vi.fn(() => ({ returning }));
  deleteMock.mockReturnValue({ where });
  return { where, returning };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("getRouterParam", mockGetRouterParam);
  mockCreateError.mockClear();
  mockGetRouterParam.mockReset();
  deleteMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DELETE /api/sources/:uuid", () => {
  it("returns meta.deleted of 1 when the source is deleted", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    stubDeleteResult([{ uuid: validUuid }]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({ meta: { deleted: 1 } });
  });

  it("throws 404 when the source does not exist for the user", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    stubDeleteResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 404,
      data: {
        errors: [
          {
            status: "404",
            title: "Not Found",
            detail: "No source was found for the given uuid.",
          },
        ],
      },
    });
  });

  it("throws 400 when the uuid is malformed", async () => {
    mockGetRouterParam.mockReturnValue("not-a-valid-uuid");

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 400,
      data: {
        errors: [
          {
            status: "400",
            title: "Invalid Parameter",
            detail: "The uuid parameter is missing or malformed.",
            source: { parameter: "uuid" },
          },
        ],
      },
    });
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);

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
});
