import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { records, sources } from "../../../../server/db/schema";

// Walks a real drizzle SQL predicate's queryChunks, collecting the Column
// objects it references (by identity) and any bound Param values, so a test
// can assert the predicate's structure without depending on generated SQL text.
function collectPredicate(
  node: unknown,
  columns: Set<unknown> = new Set(),
  paramValues: unknown[] = [],
): { columns: Set<unknown>; paramValues: unknown[] } {
  if (!node || typeof node !== "object") {
    return { columns, paramValues };
  }

  const candidate = node as {
    queryChunks?: unknown[];
    value?: unknown;
    constructor?: { name?: string };
  };

  if (candidate.constructor?.name === "Param") {
    paramValues.push(candidate.value);
  }

  if ("table" in node && "name" in node) {
    columns.add(node);
  }

  if (Array.isArray(candidate.queryChunks)) {
    for (const chunk of candidate.queryChunks) {
      collectPredicate(chunk, columns, paramValues);
    }
  }

  return { columns, paramValues };
}

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
  const leftJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ leftJoin }));
  selectMock.mockReturnValue({ from });
  return { from, leftJoin, where, limit };
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

  it("left-joins the sources table with a tenant-scoped predicate", async () => {
    const { leftJoin } = stubSelectResult([sampleRecord]);

    const db = (await import("../../../../server/db")).getDb();
    await findRecordForUser(db, validUuid, userId);

    expect(leftJoin.mock.calls[0]?.[0]).toBe(sources);

    // Tenant-scoping is the security-relevant half of the join: without
    // `sources.userId = userId` a record could surface another user's source
    // type. Walk the real drizzle predicate's chunks and assert it references
    // the sources.userId column and binds this userId, so deleting that clause
    // fails loudly (list.test.ts pins the same shape via mocked drizzle).
    const joinPredicate = leftJoin.mock.calls[0]?.[1];
    const { columns, paramValues } = collectPredicate(joinPredicate);
    expect(columns.has(records.sourceId)).toBe(true);
    expect(columns.has(sources.uuid)).toBe(true);
    expect(columns.has(sources.userId)).toBe(true);
    expect(paramValues).toContain(userId);
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
          sourceType: null,
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

  it("surfaces the joined source type on the serialized record", async () => {
    stubSelectResult([
      {
        ...sampleRecord,
        sourceId: "550e8400-e29b-41d4-a716-446655440099",
        source: "My Zapier hook",
        sourceType: "zapier",
      },
    ]);

    const response = await handler(buildEvent(userId));

    expect(response.data?.attributes.sourceType).toBe("zapier");
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
