import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const updateMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ update: updateMock }),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockGetRouterParam = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } =
  await import("../../../../server/api/tokens/[id].delete");

const userId = "user_abc123";
const tokenId = "550e8400-e29b-41d4-a716-446655440001";

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function stubUpdateResult(rows: { id: string }[]) {
  const returning = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
  return { set, where, returning };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("getRouterParam", mockGetRouterParam);
  mockCreateError.mockClear();
  mockGetRouterParam.mockClear();
  updateMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DELETE /api/tokens/:id", () => {
  it("returns null data when the token is revoked successfully", async () => {
    mockGetRouterParam.mockReturnValue(tokenId);
    stubUpdateResult([{ id: tokenId }]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({ data: null });
  });

  it("throws 404 when the token does not exist or belongs to another user", async () => {
    mockGetRouterParam.mockReturnValue(tokenId);
    stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 404,
      data: {
        errors: [
          expect.objectContaining({ status: "404", detail: "Token not found" }),
        ],
      },
    });
  });

  it("throws 404 when the token is already revoked", async () => {
    mockGetRouterParam.mockReturnValue(tokenId);
    stubUpdateResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 404,
      data: { errors: [expect.objectContaining({ status: "404" })] },
    });
  });

  it("throws 401 when the user is not authenticated", async () => {
    mockGetRouterParam.mockReturnValue(tokenId);

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

  it("throws 400 when the token ID is missing from the route", async () => {
    mockGetRouterParam.mockReturnValue(undefined);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 400,
      data: { errors: [expect.objectContaining({ status: "400" })] },
    });
  });

  it("throws 400 when the token ID is not a valid UUID", async () => {
    mockGetRouterParam.mockReturnValue("not-a-uuid");

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 400,
      data: {
        errors: [
          expect.objectContaining({
            status: "400",
            detail: "The id parameter is missing or malformed.",
          }),
        ],
      },
    });
  });
});
