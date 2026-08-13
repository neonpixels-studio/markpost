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

const mockReadBody = vi.fn();
const mockGetRouterParam = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const { default: handler } =
  await import("../../../../server/api/sources/[uuid].patch");

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
  routeFolder: "05-stripe/",
  fieldMapping: { event: "$.type" },
  lastHitAt: null,
  recordCount: 0,
};

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function buildBody(attributes: Record<string, unknown>) {
  return { data: { type: "sources", attributes } };
}

function stubUpdateResult(rows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(rows));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
  return { set, where, returning };
}

function expectRouteFolderError(detail: string) {
  expect(mockCreateError).toHaveBeenCalledWith({
    statusCode: 422,
    data: {
      errors: [
        {
          status: "422",
          title: "Invalid Attribute",
          detail,
          source: { pointer: "/data/attributes/routeFolder" },
        },
      ],
    },
  });
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readBody", mockReadBody);
  vi.stubGlobal("getRouterParam", mockGetRouterParam);
  mockCreateError.mockClear();
  mockReadBody.mockClear();
  mockGetRouterParam.mockReset();
  updateMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PATCH /api/sources/:uuid", () => {
  it("returns the updated source when both routeFolder and fieldMapping are provided", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({
        routeFolder: "05-stripe/",
        fieldMapping: { event: "$.type" },
      }),
    );
    stubUpdateResult([sampleSource]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: {
        type: "sources",
        id: validUuid,
        attributes: {
          uuid: validUuid,
          userId,
          createdAt: sampleSource.createdAt,
          type: sampleSource.type,
          name: sampleSource.name,
          provider: null,
          providerSecret: null,
          endpointSlug: sampleSource.endpointSlug,
          routeFolder: "05-stripe/",
          fieldMapping: { event: "$.type" },
          lastHitAt: null,
          recordCount: 0,
        },
        links: { self: `/api/sources/${validUuid}` },
      },
    });
  });

  it("never reveals providerSecret, even when the underlying row has one", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ routeFolder: "05-stripe/" }));
    stubUpdateResult([
      {
        ...sampleSource,
        provider: "github",
        providerSecret: "leaked-secret",
        routeFolder: "05-stripe/",
      },
    ]);

    const response = await handler(buildEvent(userId));

    expect(response).toMatchObject({
      data: { attributes: { providerSecret: null } },
    });
  });

  it("updates only routeFolder without touching fieldMapping", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ routeFolder: "05-stripe/" }));
    const updatedSource = { ...sampleSource, routeFolder: "05-stripe/" };
    const { set } = stubUpdateResult([updatedSource]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ routeFolder: "05-stripe/" });
  });

  it("ignores provider and providerSecret in the request body — PATCH cannot change either", async () => {
    // Provider identity is fixed at creation, and PATCH never touches the
    // secret either — rotating a secret is a separate action with its own
    // reveal-once semantics (POST /api/sources/:uuid/rotate-secret). PATCH
    // stays a plain routeFolder/fieldMapping update.
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({
        routeFolder: "05-stripe/",
        provider: "github",
        providerSecret: "attacker-supplied-secret",
      }),
    );
    const { set } = stubUpdateResult([
      { ...sampleSource, routeFolder: "05-stripe/" },
    ]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ routeFolder: "05-stripe/" });
    expect(set).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: expect.anything() }),
    );
    expect(set).not.toHaveBeenCalledWith(
      expect.objectContaining({ providerSecret: expect.anything() }),
    );
  });

  it("updates only fieldMapping without touching routeFolder", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({ fieldMapping: { event: "$.type" } }),
    );
    const updatedSource = { ...sampleSource };
    const { set } = stubUpdateResult([updatedSource]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ fieldMapping: { event: "$.type" } });
  });

  it("throws 422 when no updatable fields are provided", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({}));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 422,
      data: { errors: expect.any(Array) },
    });
  });

  it("throws 422 when routeFolder is not a string", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ routeFolder: 123 }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError("RouteFolder must be a string");
  });

  it("throws 422 when routeFolder contains path traversal", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ routeFolder: "../../etc" }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError(
      "RouteFolder must not contain path traversal segments (..)",
    );
  });

  it("throws 422 when routeFolder has a leading slash (absolute path)", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ routeFolder: "/etc/passwd" }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError(
      "RouteFolder must be a relative path — no leading slash or backslash",
    );
  });

  it("throws 422 when routeFolder contains hazardous characters", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ routeFolder: "notes\\work" }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError(
      "RouteFolder may only contain letters, numbers, spaces, and . _ - /",
    );
  });

  it("throws 422 when a routeFolder segment is padded with whitespace", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ routeFolder: "notes " }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError(
      "RouteFolder path segments must not be empty, padded with whitespace, or end in a dot",
    );
  });

  it("throws 422 when routeFolder is an empty string", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ routeFolder: "" }));

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 422,
    });
    expectRouteFolderError("RouteFolder must not be empty");
  });

  it("accepts a legitimate nested routeFolder", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(buildBody({ routeFolder: "notes/work" }));
    const { set } = stubUpdateResult([
      { ...sampleSource, routeFolder: "notes/work" },
    ]);

    await handler(buildEvent(userId));

    expect(set).toHaveBeenCalledWith({ routeFolder: "notes/work" });
  });

  it("throws 404 when the source does not exist for the user", async () => {
    mockGetRouterParam.mockReturnValue(validUuid);
    mockReadBody.mockResolvedValue(
      buildBody({ routeFolder: "05-stripe/", fieldMapping: null }),
    );
    stubUpdateResult([]);

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
    mockGetRouterParam.mockReturnValue("not-a-uuid");
    mockReadBody.mockResolvedValue(
      buildBody({ routeFolder: "99-incoming/", fieldMapping: null }),
    );

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
