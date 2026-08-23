import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { SOURCE_TYPES } from "../../../../shared/utils/sourceTypes";
import { records, sources } from "../../../../server/db/schema";

const selectMock = vi.fn();

vi.mock("../../../../server/db", () => ({
  getDb: () => ({ select: selectMock }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  count: () => ({ count: true }),
  desc: (column: unknown) => ({ desc: column }),
  eq: (column: unknown, value: unknown) => ({ eq: { column, value } }),
  // The real handler spreads the record columns into the page select; the
  // select router below only needs to tell the page query apart from the
  // count/cursor/subquery selects, which it does via the sourceType key the
  // page query adds, so this mock can return an empty column set.
  getTableColumns: () => ({}),
  ilike: (column: unknown, pattern: unknown) => ({
    ilike: { column, pattern },
  }),
  inArray: (column: unknown, subquery: unknown) => ({
    inArray: { column, subquery },
  }),
  // Kept in the factory (even though the handler no longer calls it) so the
  // "does not filter on records.source" regression guard can detect a
  // reintroduced like(records.source, …) instead of throwing on undefined.
  like: (column: unknown, pattern: unknown) => ({ like: { column, pattern } }),
  lt: (column: unknown, value: unknown) => ({ lt: { column, value } }),
  or: (...conditions: unknown[]) => ({ or: conditions }),
  SQL: class {},
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

let queryParams: Record<string, string | string[]> = {};
const mockGetQuery = vi.fn(() => queryParams);

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const handler = (await import("../../../../server/api/records/index.get"))
  .default;

const userId = "user_abc123";

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function stubSelectResults(
  countRow: unknown,
  pageRows: unknown[],
  cursorRow: unknown = null,
) {
  const countWhere = vi.fn(() => Promise.resolve([countRow]));
  const countFrom = vi.fn(() => ({ where: countWhere }));

  const pageLimit = vi.fn(() => Promise.resolve(pageRows));
  const pageOrderBy = vi.fn(() => ({ limit: pageLimit }));
  const pageWhere = vi.fn(() => ({ orderBy: pageOrderBy }));
  const pageLeftJoin = vi.fn(() => ({ where: pageWhere }));
  const pageFrom = vi.fn(() => ({ leftJoin: pageLeftJoin }));

  // Cursor lookup selects { createdAt, uuid }; keep it distinct from the
  // source subquery (which selects { uuid } only) by checking createdAt first.
  const cursorLimit = vi.fn(() =>
    Promise.resolve(cursorRow ? [cursorRow] : []),
  );
  const cursorWhere = vi.fn(() => ({ limit: cursorLimit }));
  const cursorFrom = vi.fn(() => ({ where: cursorWhere }));

  // The source-type filter builds a subquery via db.select({ uuid }); it is
  // passed to inArray, never awaited, so it only needs to be chainable.
  const sourceSubWhere = vi.fn(() => ({ __sourceSubquery: true }));
  const sourceSubFrom = vi.fn(() => ({ where: sourceSubWhere }));

  // Route by the selected columns instead of call order: the source-type
  // subquery and cursor lookup add extra db.select() calls, so a call-count
  // heuristic would misroute the count/page queries.
  selectMock.mockImplementation((columns?: Record<string, unknown>) => {
    // The page query is the only select that adds a sourceType column (from the
    // sources join), so match it on that key. Checked first so it can never be
    // misrouted by the cursor/subquery column checks below.
    if (columns && "sourceType" in columns) {
      return { from: pageFrom };
    }

    if (columns && "createdAt" in columns) {
      return { from: cursorFrom };
    }

    if (columns && "uuid" in columns) {
      return { from: sourceSubFrom };
    }

    if (columns && "value" in columns) {
      return { from: countFrom };
    }

    return { from: pageFrom };
  });

  return {
    countWhere,
    pageWhere,
    pageLeftJoin,
    sourceSubFrom,
    sourceSubWhere,
    cursorWhere,
  };
}

function stubRequireUser(returnedUserId: string | undefined) {
  vi.stubGlobal("requireUser", (event: H3Event) => {
    const contextUserId = (event.context as { userId?: string }).userId;
    if (!contextUserId) {
      throw mockCreateError({
        statusCode: 401,
        data: {
          errors: [
            {
              status: "401",
              title: "Unauthorized",
              detail: "Authentication is required to access this resource.",
            },
          ],
        },
      });
    }

    return returnedUserId ?? contextUserId;
  });
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("getQuery", mockGetQuery);
  stubRequireUser(userId);
  mockCreateError.mockClear();
  selectMock.mockReset();
  queryParams = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/records", () => {
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

  it("returns an empty list when no records exist", async () => {
    stubSelectResults({ value: 0 }, []);

    const response = await handler(buildEvent(userId));

    expect(response).toMatchObject({ data: [] });
  });

  it("throws 400 for an invalid filter[source] value instead of returning an unfiltered list", async () => {
    queryParams = { "filter[source]": "invalid_type" };
    stubSelectResults({ value: 0 }, []);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 400,
      data: {
        errors: [
          {
            status: "400",
            title: "Invalid filter[source]",
            detail: expect.stringContaining("filter[source] must be one of"),
            source: { parameter: "filter[source]" },
          },
        ],
      },
    });
  });

  // Pinned literal (not derived from SOURCE_TYPES) so dropping a type from the
  // shared constant fails this test, rather than silently shrinking the
  // it.each below along with it. (The coupling with what POST /api/sources
  // accepts is covered separately in tests/server/api/sources/create.test.ts,
  // which imports this same constant.) "rss" is deliberately absent — there's
  // no polling infrastructure to service it, so it's rejected at creation
  // (see tests/server/api/sources/create.test.ts's 'rss' 422 test).
  it("pins the shared SOURCE_TYPES contract to the six known source types", () => {
    expect(SOURCE_TYPES).toEqual([
      "webhook",
      "email",
      "stripe",
      "github",
      "zapier",
      "shortcuts",
    ]);
  });

  type SourceIdInArrayCondition = {
    inArray: { column: unknown; subquery: unknown };
  };

  // The source-type filter must key off records.sourceId (a FK into sources),
  // never the free-text records.source display name. Find the inArray
  // condition and confirm it targets the sourceId column (compared by column
  // object, not name, so a schema rename can't silently pass this).
  function findSourceIdInArray(
    conditions: unknown[],
  ): SourceIdInArrayCondition | undefined {
    return conditions.find((condition) => {
      if (typeof condition !== "object" || condition === null) {
        return false;
      }
      if (!("inArray" in condition)) {
        return false;
      }

      return (
        (condition as SourceIdInArrayCondition).inArray.column ===
        records.sourceId
      );
    }) as SourceIdInArrayCondition | undefined;
  }

  function hasEqCondition(
    conditions: unknown[],
    column: unknown,
    value: unknown,
  ): boolean {
    return conditions.some(
      (condition) =>
        typeof condition === "object" &&
        condition !== null &&
        "eq" in condition &&
        (condition as { eq: { column: unknown; value: unknown } }).eq.column ===
          column &&
        (condition as { eq: { value: unknown } }).eq.value === value,
    );
  }

  // The cursor predicate is `or(lt(createdAt), and(...))`; detect it by the
  // lt(records.createdAt) branch so a change that drops the cursor from a
  // query fails loudly.
  function hasCursorPredicate(conditions: unknown[]): boolean {
    return conditions.some(
      (condition) =>
        typeof condition === "object" &&
        condition !== null &&
        "or" in condition &&
        Array.isArray((condition as { or: unknown[] }).or) &&
        (condition as { or: unknown[] }).or.some(
          (branch) =>
            typeof branch === "object" &&
            branch !== null &&
            "lt" in branch &&
            (branch as { lt: { column: unknown } }).lt.column ===
              records.createdAt,
        ),
    );
  }

  it("uses the first value when filter[source] is repeated in the query string", async () => {
    queryParams = { "filter[source]": ["webhook", "email"] };
    const { countWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const whereArg = countWhere.mock.calls[0]?.[0] as { and: unknown[] };
    expect(findSourceIdInArray(whereArg.and)).toBeDefined();
  });

  it.each(SOURCE_TYPES)(
    "filters by sources.type via records.sourceId when filter[source]=%s",
    async (sourceType) => {
      queryParams = { "filter[source]": sourceType };
      const { countWhere, sourceSubFrom, sourceSubWhere } = stubSelectResults(
        { value: 0 },
        [],
      );

      await handler(buildEvent(userId));

      const whereArg = countWhere.mock.calls[0]?.[0] as { and: unknown[] };
      expect(findSourceIdInArray(whereArg.and)).toBeDefined();

      // The subquery must read from the sources table and project its uuid —
      // reading records or projecting a different column would break the IN.
      expect(sourceSubFrom).toHaveBeenCalledWith(sources);
      expect(selectMock).toHaveBeenCalledWith({ uuid: sources.uuid });

      // The subquery that resolves matching source uuids must constrain
      // sources.type to the requested type AND scope to the requesting user,
      // so it never leaks another user's source uuids into the IN clause.
      const subConditions = (
        sourceSubWhere.mock.calls[0]?.[0] as { and: unknown[] }
      ).and;
      expect(hasEqCondition(subConditions, sources.type, sourceType)).toBe(
        true,
      );
      expect(hasEqCondition(subConditions, sources.userId, userId)).toBe(true);
    },
  );

  it("applies the source-type filter to the page query, not just the count query", async () => {
    queryParams = { "filter[source]": "webhook" };
    const { pageWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const pageWhereArg = pageWhere.mock.calls[0]?.[0] as { and: unknown[] };
    expect(findSourceIdInArray(pageWhereArg.and)).toBeDefined();
  });

  it("left-joins sources on records.sourceId so the real source type is available", async () => {
    const { pageLeftJoin } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const [joinedTable, joinPredicate] = pageLeftJoin.mock.calls[0] ?? [];
    expect(joinedTable).toBe(sources);
    const joinConditions = (joinPredicate as { and: unknown[] }).and;
    expect(hasEqCondition(joinConditions, records.sourceId, sources.uuid)).toBe(
      true,
    );
    // Tenant-scoped: the join must also pin sources.userId so it can never
    // surface another user's source type.
    expect(hasEqCondition(joinConditions, sources.userId, userId)).toBe(true);
  });

  it("exposes the joined source type on each serialized record", async () => {
    stubSelectResults({ value: 1 }, [
      {
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        createdAt: new Date("2024-01-15T10:00:00Z"),
        userId,
        title: "Test",
        content: "Body",
        sourceId: "550e8400-e29b-41d4-a716-446655440099",
        source: "My GitHub hook",
        sourceType: "github",
        status: "synced",
        filePath: null,
        tags: null,
        frontmatter: null,
        syncedAt: null,
        errorMessage: null,
      },
    ]);

    const response = await handler(buildEvent(userId));

    expect(response.data[0]?.attributes.sourceType).toBe("github");
  });

  // Regression guard for the original bug: type filtering matched
  // `like(records.source, "webhook/%")`, but ingest stores the source's
  // display name in records.source (no type prefix), so it matched nothing.
  it("does not filter on the free-text records.source column", async () => {
    queryParams = { "filter[source]": "webhook" };
    const { countWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const whereArg = countWhere.mock.calls[0]?.[0] as { and: unknown[] };
    const hasSourceNameCondition = whereArg.and.some(
      (condition) =>
        typeof condition === "object" &&
        condition !== null &&
        ((condition as { like?: { column: unknown } }).like?.column ===
          records.source ||
          (condition as { ilike?: { column: unknown } }).ilike?.column ===
            records.source ||
          (condition as { eq?: { column: unknown } }).eq?.column ===
            records.source),
    );
    expect(hasSourceNameCondition).toBe(false);
  });

  it("ignores an empty filter[source] value rather than treating it as invalid", async () => {
    queryParams = { "filter[source]": "" };
    const { countWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const whereArg = countWhere.mock.calls[0]?.[0] as { and: unknown[] };
    expect(whereArg.and).toHaveLength(1);
  });

  it("ignores an invalid filter[status] value and does not add a second eq condition", async () => {
    queryParams = { "filter[status]": "unknown_status" };
    const { countWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const noFilterWhereArg = countWhere.mock.calls[0]?.[0];
    const conditions = (noFilterWhereArg as { and: unknown[] }).and;
    expect(conditions).toHaveLength(1);
  });

  it("applies a status filter when filter[status]=error", async () => {
    queryParams = { "filter[status]": "error" };
    const { countWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const whereArg = countWhere.mock.calls[0]?.[0] as { and: unknown[] };
    const conditions = whereArg.and;
    const hasStatusCondition = conditions.some(
      (condition) =>
        typeof condition === "object" &&
        condition !== null &&
        "eq" in condition &&
        (condition as { eq: { value: unknown } }).eq.value === "error",
    );
    expect(hasStatusCondition).toBe(true);
  });

  type QueryCondition = {
    or: { ilike: { column: unknown; pattern: unknown } }[];
  };

  function isIlikeBranch(branch: unknown): boolean {
    return typeof branch === "object" && branch !== null && "ilike" in branch;
  }

  // filter[q] matches records via an `or(ilike(title), ilike(content))`
  // condition nested inside the top-level `and`. The cursor predicate is
  // also shaped `{ or: [...] }` under this mock, so narrow to `or` branches
  // that are themselves non-empty and entirely ILIKE conditions, to avoid
  // matching the cursor (or an empty/partial `or` from a regression).
  function findQueryCondition(
    conditions: unknown[],
  ): QueryCondition | undefined {
    return conditions.find((condition) => {
      if (typeof condition !== "object" || condition === null) {
        return false;
      }
      if (!("or" in condition)) {
        return false;
      }

      const branches = (condition as { or: unknown[] }).or;
      if (!Array.isArray(branches) || branches.length === 0) {
        return false;
      }

      return branches.every(isIlikeBranch);
    }) as QueryCondition | undefined;
  }

  // The two ends of an `or(ilike(title), ilike(content))` condition, as
  // column names, in the order returned by buildFilterConditions.
  function matchedColumnNames(queryCondition: QueryCondition | undefined) {
    return queryCondition?.or.map(
      (condition) => (condition.ilike.column as { name?: string })?.name,
    );
  }

  it("applies an ILIKE filter on title OR content when filter[q] is set", async () => {
    queryParams = { "filter[q]": "invoice" };
    const { countWhere, pageWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const whereArg = countWhere.mock.calls[0]?.[0] as { and: unknown[] };
    const queryCondition = findQueryCondition(whereArg.and);
    expect(queryCondition?.or).toHaveLength(2);
    expect(
      queryCondition?.or.every(
        (condition) => condition.ilike.pattern === "%invoice%",
      ),
    ).toBe(true);

    // The page query builds its own conditions independently of the count
    // query, so a change that only updates one of them must still fail here.
    const pageWhereArg = pageWhere.mock.calls[0]?.[0] as { and: unknown[] };
    const pageQueryCondition = findQueryCondition(pageWhereArg.and);
    expect(pageQueryCondition?.or).toHaveLength(2);
  });

  it("matches on records.content, not just records.title, for filter[q]", async () => {
    queryParams = { "filter[q]": "invoice" };
    const { countWhere, pageWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const whereArg = countWhere.mock.calls[0]?.[0] as { and: unknown[] };
    const queryCondition = findQueryCondition(whereArg.and);
    expect(matchedColumnNames(queryCondition)).toEqual(["title", "content"]);

    const pageWhereArg = pageWhere.mock.calls[0]?.[0] as { and: unknown[] };
    const pageQueryCondition = findQueryCondition(pageWhereArg.and);
    expect(matchedColumnNames(pageQueryCondition)).toEqual([
      "title",
      "content",
    ]);
  });

  it("trims whitespace from filter[q] before searching", async () => {
    queryParams = { "filter[q]": "  invoice  " };
    const { countWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const whereArg = countWhere.mock.calls[0]?.[0] as { and: unknown[] };
    const queryCondition = findQueryCondition(whereArg.and);
    expect(matchedColumnNames(queryCondition)).toEqual(["title", "content"]);
    expect(
      queryCondition?.or.every(
        (condition) => condition.ilike.pattern === "%invoice%",
      ),
    ).toBe(true);
  });

  it("escapes LIKE wildcard characters in filter[q]", async () => {
    queryParams = { "filter[q]": "100%_off\\" };
    const { countWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const whereArg = countWhere.mock.calls[0]?.[0] as { and: unknown[] };
    const queryCondition = findQueryCondition(whereArg.and);
    expect(matchedColumnNames(queryCondition)).toEqual(["title", "content"]);
    expect(
      queryCondition?.or.every(
        (condition) => condition.ilike.pattern === "%100\\%\\_off\\\\%",
      ),
    ).toBe(true);
  });

  it("ignores an empty or whitespace-only filter[q] and does not add an ILIKE condition", async () => {
    queryParams = { "filter[q]": "   " };
    const { countWhere } = stubSelectResults({ value: 0 }, []);

    await handler(buildEvent(userId));

    const whereArg = countWhere.mock.calls[0]?.[0] as { and: unknown[] };
    expect(whereArg.and).toHaveLength(1);
    expect(findQueryCondition(whereArg.and)).toBeUndefined();
  });

  it("throws 400 when page[after] references a record that is not found", async () => {
    queryParams = { "page[after]": "missing-uuid" };
    stubSelectResults({ value: 0 }, [], null);

    await expect(handler(buildEvent(userId))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 400,
      data: {
        errors: [expect.objectContaining({ title: "Invalid cursor" })],
      },
    });
  });

  // The cursor predicate keeps the page moving forward, but the count must
  // stay the unpaginated total — countFilteredRecords passes cursor: null.
  // A regression that applied the cursor to the count query would understate
  // total, so pin it out of count and into page.
  it("applies the cursor predicate to the page query only, not the count query", async () => {
    queryParams = { "page[after]": "cursor-uuid" };
    const cursorRow = {
      createdAt: new Date("2026-01-01T00:00:00Z"),
      uuid: "cursor-uuid",
    };
    const { countWhere, pageWhere } = stubSelectResults(
      { value: 3 },
      [],
      cursorRow,
    );

    await handler(buildEvent(userId));

    const countConditions = (
      countWhere.mock.calls[0]?.[0] as { and: unknown[] }
    ).and;
    const pageConditions = (pageWhere.mock.calls[0]?.[0] as { and: unknown[] })
      .and;

    expect(hasCursorPredicate(pageConditions)).toBe(true);
    expect(hasCursorPredicate(countConditions)).toBe(false);
  });

  // Page 2 of a filtered list is the realistic case: the page query must carry
  // BOTH the source-type filter and the cursor, while the count query carries
  // the filter (for an accurate unpaginated total) but not the cursor.
  it("combines the source-type filter with the cursor on the page query", async () => {
    queryParams = { "filter[source]": "webhook", "page[after]": "cursor-uuid" };
    const cursorRow = {
      createdAt: new Date("2026-01-01T00:00:00Z"),
      uuid: "cursor-uuid",
    };
    const { countWhere, pageWhere } = stubSelectResults(
      { value: 5 },
      [],
      cursorRow,
    );

    await handler(buildEvent(userId));

    const countConditions = (
      countWhere.mock.calls[0]?.[0] as { and: unknown[] }
    ).and;
    const pageConditions = (pageWhere.mock.calls[0]?.[0] as { and: unknown[] })
      .and;

    expect(findSourceIdInArray(pageConditions)).toBeDefined();
    expect(hasCursorPredicate(pageConditions)).toBe(true);

    expect(findSourceIdInArray(countConditions)).toBeDefined();
    expect(hasCursorPredicate(countConditions)).toBe(false);
  });
});
