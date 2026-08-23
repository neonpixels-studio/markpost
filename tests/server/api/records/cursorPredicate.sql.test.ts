import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// list.test.ts mocks drizzle-orm wholesale, so it can only prove the handler
// pushes *a* cursor condition onto the query — not that drizzle compiles it to
// the row-wise tuple comparison Postgres can use as an index range start. This
// file does NOT mock drizzle: it compiles the real condition and asserts the
// generated SQL, the one layer the mocks can't reach.
vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);

const { recordCursorCondition } =
  await import("../../../../server/api/records/index.get");

describe("recordCursorCondition (compiled SQL)", () => {
  const cursor = {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    uuid: "11111111-1111-1111-1111-111111111111",
  };

  it("emits a (created_at, uuid) row comparison, not an OR predicate", () => {
    const { sql, params } = new PgDialect().sqlToQuery(
      recordCursorCondition(cursor),
    );

    // A single tuple comparison the planner can seek with, in the same column
    // order as records_user_id_created_at_idx.
    expect(sql).toBe('("records"."created_at", "records"."uuid") < ($1, $2)');
    expect(params).toEqual([cursor.createdAt, cursor.uuid]);

    // The pre-keyset shape re-walked from the top; prove it is gone.
    expect(sql).not.toContain(" or ");
  });
});
