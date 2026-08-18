import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const selectMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockGetRouterParam = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } =
  await import("../../../../server/api/sources/[uuid].get");

const userId = "user_abc123";
const validUuid = "550e8400-e29b-41d4-a716-446655440001";

const sampleSource = {
  uuid: validUuid,
  userId,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  type: "webhook",
  name: "My Webhook",
  provider: null,
  endpointSlug: "wh_8f2a91c4",
  routeFolder: "99-incoming/",
  fieldMapping: null,
  lastHitAt: null,
  recordCount: 0,
};

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function stubSelectResult(rows: unknown[]) {
  const limit = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
  return { from, where, limit };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("getRouterParam", mockGetRouterParam);
  mockCreateError.mockClear();
  mockGetRouterParam.mockReset();
  selectMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/sources/:uuid", () => {
  it("returns the serialized source for the authenticated owner", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    stubSelectResult([sampleSource]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: {
        type: "sources",
        id: sampleSource.uuid,
        attributes: {
          uuid: sampleSource.uuid,
          userId,
          createdAt: sampleSource.createdAt,
          type: sampleSource.type,
          name: sampleSource.name,
          provider: null,
          providerSecret: null,
          endpointSlug: sampleSource.endpointSlug,
          routeFolder: sampleSource.routeFolder,
          fieldMapping: null,
          lastHitAt: null,
          recordCount: 0,
        },
        links: { self: `/api/sources/${sampleSource.uuid}` },
      },
    });
  });

  it("never reveals providerSecret, even when the row has one", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    stubSelectResult([
      { ...sampleSource, provider: "github", providerSecret: "leaked-secret" },
    ]);

    const response = await handler(buildEvent(userId));

    expect(response.data?.attributes.providerSecret).toBeNull();
  });

  it("throws 404 when no source matches the uuid for the user", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    stubSelectResult([]);

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

  it("scopes the query with a filter (ownership enforced, other-user uuid 404s)", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    const { where } = stubSelectResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 404,
    });
    // A filter condition must be applied; an unfiltered select would return
    // another user's source. The empty result models "not owned by this user".
    expect(where).toHaveBeenCalledTimes(1);
    expect(where.mock.calls[0][0]).toBeDefined();
  });

  it("throws 400 when the uuid param is missing (undefined)", async () => {
    mockGetRouterParam.mockReturnValue(undefined);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("maps an unexpected database failure to a generic 500", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    const limit = vi.fn(() => Promise.reject(new Error("connection refused")));
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    selectMock.mockReturnValue({ from });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: "Internal Server Error",
    });
    // The internal failure detail must never reach the client body.
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 500,
      statusMessage: "Internal Server Error",
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
