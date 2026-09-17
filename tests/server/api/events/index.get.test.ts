import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const selectMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => ({ conditions }),
  or: (...conditions: unknown[]) => ({ or: conditions }),
  lt: (column: unknown, value: unknown) => ({ lt: { column, value } }),
  count: () => ({ count: true }),
  desc: (column: unknown) => ({ desc: column }),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockGetQuery = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const handler = (await import("../../../../server/api/events/index.get"))
  .default;

const userId = "user_abc123";

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function makeEventRow(
  index: number,
  overrides: { kind?: string; sourceId?: string | null } = {},
) {
  return {
    id: `id-${index}`,
    userId,
    ts: new Date(`2024-06-${String(index).padStart(2, "0")}T10:00:00Z`),
    kind: overrides.kind ?? "ok",
    message: `Event ${index}`,
    recordUuid: null,
    sourceId: overrides.sourceId ?? null,
  };
}

function stubSelectChain(rows: unknown[], countValue = 0) {
  let callCount = 0;

  selectMock.mockImplementation(() => {
    const callIndex = callCount;
    callCount++;

    const whereForCount = vi.fn(() => Promise.resolve([{ value: countValue }]));
    const fromForCount = vi.fn(() => ({ where: whereForCount }));

    const limitFn = vi.fn(() => Promise.resolve(rows));
    const orderByFn = vi.fn(() => ({ limit: limitFn }));
    const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
    const fromFn = vi.fn(() => ({ where: whereFn }));

    if (callIndex === 0) {
      return { from: fromForCount };
    }

    return { from: fromFn };
  });
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("getQuery", mockGetQuery);
  mockCreateError.mockClear();
  mockGetQuery.mockReturnValue({});
  selectMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/events", () => {
  it("throws 401 when user is not authenticated", async () => {
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

  it("returns empty data when no events exist", async () => {
    stubSelectChain([], 0);

    const response = await handler(buildEvent(userId));

    expect(response.data).toEqual([]);
    expect(response.meta).toEqual({ total: 0, size: 100, hasMore: false });
    expect(response.links?.next).toBeNull();
  });

  it("returns serialized events newest first", async () => {
    const rows = [makeEventRow(5), makeEventRow(4), makeEventRow(3)];
    stubSelectChain(rows, 3);

    const response = await handler(buildEvent(userId));

    expect(response.data).toHaveLength(3);
    expect(response.data[0].id).toBe("id-5");
    expect(response.data[0].attributes.kind).toBe("ok");
    expect(response.data[0].attributes.message).toBe("Event 5");
    expect(response.data[0].type).toBe("events");
  });

  it("returns a next cursor link when there are more results", async () => {
    const rows = [makeEventRow(3), makeEventRow(2), makeEventRow(1)];
    stubSelectChain(rows, 10);
    mockGetQuery.mockReturnValue({ "page[size]": "2" });

    const response = await handler(buildEvent(userId));

    expect(response.data).toHaveLength(2);
    expect(response.meta?.hasMore).toBe(true);
    expect(response.links?.next).toContain("/api/events");
    expect(response.links?.next).toContain("page%5Bafter%5D=id-2");
  });

  it("resolves cursor and returns results when page[after] is set", async () => {
    const cursorId = "550e8400-e29b-41d4-a716-446655440003";
    const rows = [makeEventRow(2), makeEventRow(1)];
    mockGetQuery.mockReturnValue({
      "page[after]": cursorId,
      "page[size]": "2",
    });

    let callCount = 0;
    selectMock.mockImplementation(() => {
      const callIndex = callCount;
      callCount++;

      if (callIndex === 0) {
        // findCursorPosition: select().from().where().limit(1)
        const limitFn = vi.fn(() =>
          Promise.resolve([{ ts: new Date(), id: cursorId }]),
        );
        const whereFn = vi.fn(() => ({ limit: limitFn }));
        const fromFn = vi.fn(() => ({ where: whereFn }));
        return { from: fromFn };
      }

      if (callIndex === 1) {
        // countUserEvents: select().from().where()
        const whereFn = vi.fn(() => Promise.resolve([{ value: 10 }]));
        const fromFn = vi.fn(() => ({ where: whereFn }));
        return { from: fromFn };
      }

      // fetchEventsPage: select().from().where().orderBy().limit()
      const limitFn = vi.fn(() => Promise.resolve(rows));
      const orderByFn = vi.fn(() => ({ limit: limitFn }));
      const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
      const fromFn = vi.fn(() => ({ where: whereFn }));
      return { from: fromFn };
    });

    const response = await handler(buildEvent(userId));

    expect(response.data).toHaveLength(2);
    expect(response.meta?.total).toBe(10);
  });

  it("throws 400 when the after cursor is a non-UUID string", async () => {
    mockGetQuery.mockReturnValue({ "page[after]": "not-a-uuid" });

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it("throws 400 when the after cursor is a valid UUID that does not exist", async () => {
    const validButUnknownUuid = "550e8400-e29b-41d4-a716-446655440099";
    mockGetQuery.mockReturnValue({ "page[after]": validButUnknownUuid });

    selectMock.mockImplementation(() => {
      // findCursorPosition returns empty — no cursor found
      const limitFn = vi.fn(() => Promise.resolve([]));
      const whereFn = vi.fn(() => ({ limit: limitFn }));
      const fromFn = vi.fn(() => ({ where: whereFn }));
      return { from: fromFn };
    });

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it("includes recordUuid and sourceId on each event resource", async () => {
    const rowWithRefs = {
      id: "id-1",
      userId,
      ts: new Date("2024-06-01T10:00:00Z"),
      kind: "warn",
      message: "Sync conflict",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    };
    stubSelectChain([rowWithRefs], 1);

    const response = await handler(buildEvent(userId));

    expect(response.data[0].attributes.recordUuid).toBe("rec-uuid");
    expect(response.data[0].attributes.sourceId).toBe("src-uuid");
  });

  describe("filter[kind]", () => {
    it("returns events of the requested kind", async () => {
      const rows = [makeEventRow(1, { kind: "err" })];
      stubSelectChain(rows, 1);
      mockGetQuery.mockReturnValue({ "filter[kind]": "err" });

      const response = await handler(buildEvent(userId));

      expect(response.data).toHaveLength(1);
      expect(response.data[0].attributes.kind).toBe("err");
    });

    it("takes the first value when filter[kind] is repeated", async () => {
      const rows = [makeEventRow(1, { kind: "err" })];
      stubSelectChain(rows, 1);
      mockGetQuery.mockReturnValue({ "filter[kind]": ["err", "warn"] });

      const response = await handler(buildEvent(userId));

      expect(response.data).toHaveLength(1);
    });

    it("throws 400 for an unrecognized kind", async () => {
      mockGetQuery.mockReturnValue({ "filter[kind]": "bogus" });

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(mockCreateError).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          data: {
            errors: [
              expect.objectContaining({ title: "Invalid filter[kind]" }),
            ],
          },
        }),
      );
      expect(selectMock).not.toHaveBeenCalled();
    });
  });

  describe("filter[source]", () => {
    const sourceId = "550e8400-e29b-41d4-a716-446655440010";

    it("returns events attributed to the requested source", async () => {
      const rows = [makeEventRow(1, { sourceId })];
      stubSelectChain(rows, 1);
      mockGetQuery.mockReturnValue({ "filter[source]": sourceId });

      const response = await handler(buildEvent(userId));

      expect(response.data).toHaveLength(1);
      expect(response.data[0].attributes.sourceId).toBe(sourceId);
    });

    it("throws 400 when filter[source] is not a valid uuid", async () => {
      mockGetQuery.mockReturnValue({ "filter[source]": "not-a-uuid" });

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(mockCreateError).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          data: {
            errors: [
              expect.objectContaining({ title: "Invalid filter[source]" }),
            ],
          },
        }),
      );
      expect(selectMock).not.toHaveBeenCalled();
    });
  });

  it("applies filter[kind] and filter[source] together with cursor pagination", async () => {
    const sourceId = "550e8400-e29b-41d4-a716-446655440011";
    const cursorId = "550e8400-e29b-41d4-a716-446655440003";
    const rows = [
      makeEventRow(2, { kind: "warn", sourceId }),
      makeEventRow(1, { kind: "warn", sourceId }),
    ];
    mockGetQuery.mockReturnValue({
      "page[after]": cursorId,
      "page[size]": "2",
      "filter[kind]": "warn",
      "filter[source]": sourceId,
    });

    let callCount = 0;
    selectMock.mockImplementation(() => {
      const callIndex = callCount;
      callCount++;

      if (callIndex === 0) {
        // findCursorPosition: select().from().where().limit(1)
        const limitFn = vi.fn(() =>
          Promise.resolve([{ ts: new Date(), id: cursorId }]),
        );
        const whereFn = vi.fn(() => ({ limit: limitFn }));
        const fromFn = vi.fn(() => ({ where: whereFn }));
        return { from: fromFn };
      }

      if (callIndex === 1) {
        // countFilteredEvents: select().from().where()
        const whereFn = vi.fn(() => Promise.resolve([{ value: 5 }]));
        const fromFn = vi.fn(() => ({ where: whereFn }));
        return { from: fromFn };
      }

      // fetchEventsPage: select().from().where().orderBy().limit()
      const limitFn = vi.fn(() => Promise.resolve(rows));
      const orderByFn = vi.fn(() => ({ limit: limitFn }));
      const whereFn = vi.fn(() => ({ orderBy: orderByFn }));
      const fromFn = vi.fn(() => ({ where: whereFn }));
      return { from: fromFn };
    });

    const response = await handler(buildEvent(userId));

    expect(response.data).toHaveLength(2);
    expect(response.data[0].attributes.kind).toBe("warn");
    expect(response.data[0].attributes.sourceId).toBe(sourceId);
    expect(response.meta?.total).toBe(5);
  });
});
