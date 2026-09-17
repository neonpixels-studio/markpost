import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { events, type EventKind } from "../../../../server/db/schema";

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
  overrides: { kind?: EventKind; sourceId?: string | null } = {},
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

// Returns the `where()` spies from both branches of the Promise.all in the
// handler (the count query and the page query) so tests can assert on the
// actual filter conditions built, not just on the canned rows/count the
// mock hands back regardless of what was queried.
function stubSelectChain(rows: unknown[], countValue = 0) {
  let callCount = 0;

  const countWhereFn = vi.fn(() => Promise.resolve([{ value: countValue }]));
  const fromForCount = vi.fn(() => ({ where: countWhereFn }));

  const limitFn = vi.fn(() => Promise.resolve(rows));
  const orderByFn = vi.fn(() => ({ limit: limitFn }));
  const pageWhereFn = vi.fn(() => ({ orderBy: orderByFn }));
  const fromFn = vi.fn(() => ({ where: pageWhereFn }));

  selectMock.mockImplementation(() => {
    const callIndex = callCount;
    callCount++;

    if (callIndex === 0) {
      return { from: fromForCount };
    }

    return { from: fromFn };
  });

  return { countWhereFn, pageWhereFn };
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

  it("scopes the query to the owner only when no filters are applied", async () => {
    const { countWhereFn, pageWhereFn } = stubSelectChain([], 0);

    await handler(buildEvent(userId));

    const expectedConditions = {
      conditions: [{ column: events.userId, value: userId }],
    };
    expect(pageWhereFn).toHaveBeenCalledWith(expectedConditions);
    expect(countWhereFn).toHaveBeenCalledWith(expectedConditions);
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
        // countFilteredEvents: select().from().where()
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
    it("adds an events.kind equality condition to both the count and page queries, and returns the matching row", async () => {
      const { countWhereFn, pageWhereFn } = stubSelectChain(
        [makeEventRow(1, { kind: "err" })],
        1,
      );
      mockGetQuery.mockReturnValue({ "filter[kind]": "err" });

      const response = await handler(buildEvent(userId));

      const expectedConditions = {
        conditions: [
          { column: events.userId, value: userId },
          { column: events.kind, value: "err" },
        ],
      };
      expect(pageWhereFn).toHaveBeenCalledWith(expectedConditions);
      expect(countWhereFn).toHaveBeenCalledWith(expectedConditions);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].attributes.kind).toBe("err");
    });

    it("ignores an empty filter[kind] and scopes the query to the owner only", async () => {
      const { pageWhereFn } = stubSelectChain([], 0);
      mockGetQuery.mockReturnValue({ "filter[kind]": "" });

      await handler(buildEvent(userId));

      expect(pageWhereFn).toHaveBeenCalledWith({
        conditions: [{ column: events.userId, value: userId }],
      });
    });

    it("takes the first value when filter[kind] is repeated", async () => {
      const { pageWhereFn } = stubSelectChain(
        [makeEventRow(1, { kind: "err" })],
        1,
      );
      mockGetQuery.mockReturnValue({ "filter[kind]": ["err", "warn"] });

      await handler(buildEvent(userId));

      expect(pageWhereFn).toHaveBeenCalledWith({
        conditions: [
          { column: events.userId, value: userId },
          { column: events.kind, value: "err" },
        ],
      });
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

  describe("filter[sourceId]", () => {
    const sourceId = "550e8400-e29b-41d4-a716-446655440010";

    it("adds an events.sourceId equality condition to both the count and page queries, and returns the matching row", async () => {
      const { countWhereFn, pageWhereFn } = stubSelectChain(
        [makeEventRow(1, { sourceId })],
        1,
      );
      mockGetQuery.mockReturnValue({ "filter[sourceId]": sourceId });

      const response = await handler(buildEvent(userId));

      const expectedConditions = {
        conditions: [
          { column: events.userId, value: userId },
          { column: events.sourceId, value: sourceId },
        ],
      };
      expect(pageWhereFn).toHaveBeenCalledWith(expectedConditions);
      expect(countWhereFn).toHaveBeenCalledWith(expectedConditions);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].attributes.sourceId).toBe(sourceId);
    });

    it("ignores an empty filter[sourceId] and scopes the query to the owner only", async () => {
      const { pageWhereFn } = stubSelectChain([], 0);
      mockGetQuery.mockReturnValue({ "filter[sourceId]": "" });

      await handler(buildEvent(userId));

      expect(pageWhereFn).toHaveBeenCalledWith({
        conditions: [{ column: events.userId, value: userId }],
      });
    });

    it("takes the first value when filter[sourceId] is repeated", async () => {
      const { pageWhereFn } = stubSelectChain(
        [makeEventRow(1, { sourceId })],
        1,
      );
      mockGetQuery.mockReturnValue({
        "filter[sourceId]": [sourceId, "550e8400-e29b-41d4-a716-446655440099"],
      });

      await handler(buildEvent(userId));

      expect(pageWhereFn).toHaveBeenCalledWith({
        conditions: [
          { column: events.userId, value: userId },
          { column: events.sourceId, value: sourceId },
        ],
      });
    });

    it("returns an empty page when the source matches nothing, without erroring", async () => {
      const otherUsersSourceId = "550e8400-e29b-41d4-a716-446655440020";
      const { pageWhereFn } = stubSelectChain([], 0);
      mockGetQuery.mockReturnValue({ "filter[sourceId]": otherUsersSourceId });

      const response = await handler(buildEvent(userId));

      // Confirms the empty result reflects a real (non-matching) filter
      // condition reaching the query, not a stub that would return the
      // same empty page regardless of what was asked for.
      expect(pageWhereFn).toHaveBeenCalledWith({
        conditions: [
          { column: events.userId, value: userId },
          { column: events.sourceId, value: otherUsersSourceId },
        ],
      });
      expect(response.data).toEqual([]);
      expect(response.meta).toEqual({ total: 0, size: 100, hasMore: false });
    });

    it("throws 400 when filter[sourceId] is not a valid uuid", async () => {
      mockGetQuery.mockReturnValue({ "filter[sourceId]": "not-a-uuid" });

      await expect(handler(buildEvent(userId))).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(mockCreateError).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          data: {
            errors: [
              expect.objectContaining({ title: "Invalid filter[sourceId]" }),
            ],
          },
        }),
      );
      expect(selectMock).not.toHaveBeenCalled();
    });
  });

  it("returns a next cursor link when a filtered page has more results", async () => {
    const rows = [
      makeEventRow(3, { kind: "err" }),
      makeEventRow(2, { kind: "err" }),
      makeEventRow(1, { kind: "err" }),
    ];
    stubSelectChain(rows, 10);
    mockGetQuery.mockReturnValue({
      "page[size]": "2",
      "filter[kind]": "err",
    });

    const response = await handler(buildEvent(userId));

    expect(response.data).toHaveLength(2);
    expect(
      response.data.every((resource) => resource.attributes.kind === "err"),
    ).toBe(true);
    expect(response.meta?.hasMore).toBe(true);
    expect(response.links?.next).toContain("page%5Bafter%5D=id-2");
    // The filter must carry into the next link — otherwise a client that
    // blindly follows links.next (see app/composables/useEvents.ts) falls
    // back to the unfiltered feed as soon as it crosses a page boundary.
    expect(response.links?.next).toContain("filter%5Bkind%5D=err");
  });

  it("applies filter[kind] and filter[sourceId] together with cursor pagination", async () => {
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
      "filter[sourceId]": sourceId,
    });

    let callCount = 0;
    let pageWhereArg: unknown;
    let countWhereArg: unknown;
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
        const whereFn = vi.fn((arg: unknown) => {
          countWhereArg = arg;
          return Promise.resolve([{ value: 5 }]);
        });
        const fromFn = vi.fn(() => ({ where: whereFn }));
        return { from: fromFn };
      }

      // fetchEventsPage: select().from().where().orderBy().limit()
      const limitFn = vi.fn(() => Promise.resolve(rows));
      const orderByFn = vi.fn(() => ({ limit: limitFn }));
      const whereFn = vi.fn((arg: unknown) => {
        pageWhereArg = arg;
        return { orderBy: orderByFn };
      });
      const fromFn = vi.fn(() => ({ where: whereFn }));
      return { from: fromFn };
    });

    const response = await handler(buildEvent(userId));

    expect(response.data).toHaveLength(2);
    expect(response.data[0].attributes.kind).toBe("warn");
    expect(response.data[0].attributes.sourceId).toBe(sourceId);
    expect(response.meta?.total).toBe(5);
    // meta.total is the count of ALL events matching the filters (mirroring
    // the pre-existing, cursor-agnostic countUserEvents semantics), not the
    // count remaining after the cursor — so its where() call carries the
    // same owner/kind/sourceId conditions but no cursor range condition.
    expect(countWhereArg).toEqual({
      conditions: [
        { column: events.userId, value: userId },
        { column: events.kind, value: "warn" },
        { column: events.sourceId, value: sourceId },
      ],
    });
    // Both filters and the cursor range condition are all still present
    // alongside the owner scope — filtering doesn't drop keyset pagination.
    expect(pageWhereArg).toEqual({
      conditions: [
        { column: events.userId, value: userId },
        { column: events.kind, value: "warn" },
        { column: events.sourceId, value: sourceId },
        {
          or: [
            { lt: { column: events.ts, value: expect.any(Date) } },
            {
              conditions: [
                { column: events.ts, value: expect.any(Date) },
                { lt: { column: events.id, value: cursorId } },
              ],
            },
          ],
        },
      ],
    });
  });
});
