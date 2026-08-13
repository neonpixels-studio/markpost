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

let routerParam: string | undefined;

const mockGetRouterParam = vi.fn(() => routerParam);

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const routeModule = await import("../../../../server/api/records/[uuid].get");
const handler = routeModule.default;
const findRecordForUser = routeModule.findRecordForUser;

const validUuid = "550e8400-e29b-41d4-a716-446655440000";
const userId = "user_abc123";

const sampleRecord = {
  uuid: validUuid,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  userId,
  title: "Test Post",
  content: "Some content here",
  sourceId: null,
  source: null,
  status: "pending",
  filePath: null,
  tags: null,
  frontmatter: null,
  syncedAt: null,
  errorMessage: null,
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
  mockGetRouterParam.mockClear();
  selectMock.mockReset();
  routerParam = validUuid;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("findRecordForUser", () => {
  it("returns the record when one matches the uuid and userId", async () => {
    stubSelectResult([sampleRecord]);

    const db = (await import("../../../../server/db")).getDb();
    const result = await findRecordForUser(db, validUuid, userId);

    expect(result).toEqual(sampleRecord);
  });

  it("returns null when no row matches", async () => {
    stubSelectResult([]);

    const db = (await import("../../../../server/db")).getDb();
    const result = await findRecordForUser(db, validUuid, userId);

    expect(result).toBeNull();
  });
});

describe("GET /api/records/:uuid", () => {
  it("returns a serialized record when found for the authenticated user", async () => {
    stubSelectResult([sampleRecord]);

    const response = await handler(buildEvent(userId));

    expect(response).toEqual({
      data: {
        type: "records",
        id: validUuid,
        attributes: {
          uuid: validUuid,
          createdAt: sampleRecord.createdAt,
          userId,
          title: sampleRecord.title,
          content: sampleRecord.content,
          sourceId: null,
          source: null,
          status: "pending",
          filePath: null,
          tags: null,
          frontmatter: null,
          syncedAt: null,
          errorMessage: null,
        },
        links: { self: `/api/records/${validUuid}` },
      },
    });
  });

  it("throws a 404 when no record exists for the authenticated user", async () => {
    stubSelectResult([]);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 404,
      data: { errors: expect.any(Array) },
    });
  });

  it("throws a 404 when the record belongs to a different user", async () => {
    const { where } = stubSelectResult([]);

    await expect(handler(buildEvent("user_other"))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(where).toHaveBeenCalled();
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 404,
      data: { errors: expect.any(Array) },
    });
  });

  it("throws a 401 when the user is not authenticated", async () => {
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

  it.each([
    { label: "malformed", value: "not-a-uuid" },
    { label: "missing", value: undefined },
  ])("throws a 400 when the uuid is $label", async ({ value }) => {
    routerParam = value;

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 400,
      data: { errors: expect.any(Array) },
    });
  });
});
