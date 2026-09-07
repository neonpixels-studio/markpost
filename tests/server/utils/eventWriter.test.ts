import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  validateEventKind,
  writeEvent,
  writeEventOncePerRecord,
} from "../../../server/utils/eventWriter";
import {
  events,
  eventRecordKindDedupPredicate,
} from "../../../server/db/schema";

const insertMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({ insert: insertMock }),
}));

// Retention is covered in eventRetention.test.ts; stub it here so writeEvent's
// insert behaviour is asserted in isolation, free of the prune probability.
const maybePruneEventsForUserMock = vi.fn(() => Promise.resolve());
vi.mock("../../../server/utils/eventRetention", () => ({
  maybePruneEventsForUser: (userId: string) =>
    maybePruneEventsForUserMock(userId),
}));

// Chains insert().values()[.onConflictDoNothing()].returning() the way the
// real drizzle query builder does, so each mock stage can be asserted
// individually. `returningRows` stands in for what the DB would actually
// return: a row on a genuine insert, an empty array when the partial unique
// index on (record_uuid, kind) absorbed a duplicate via onConflictDoNothing.
function stubConflictInsert(returningRows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(returningRows));
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  insertMock.mockReturnValue({ values });
  return { values, onConflictDoNothing, returning };
}

// For rows that fall outside the partial index's predicate (kind not ok/err,
// or no recordUuid): insertEventRow (server/utils/eventWriter.ts) skips
// onConflictDoNothing entirely, so the chain is one level shallower.
function stubPlainInsert(returningRows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(returningRows));
  const values = vi.fn(() => ({ returning }));
  insertMock.mockReturnValue({ values });
  return { values, returning };
}

describe("validateEventKind", () => {
  it("accepts ok", () => {
    expect(validateEventKind("ok")).toBe("ok");
  });

  it("accepts dim", () => {
    expect(validateEventKind("dim")).toBe("dim");
  });

  it("accepts warn", () => {
    expect(validateEventKind("warn")).toBe("warn");
  });

  it("accepts err", () => {
    expect(validateEventKind("err")).toBe("err");
  });

  it("throws on an unknown kind", () => {
    expect(() => validateEventKind("unknown")).toThrow(
      'Invalid event kind: "unknown"',
    );
  });

  it("throws on empty string", () => {
    expect(() => validateEventKind("")).toThrow("Invalid event kind");
  });
});

describe("writeEvent", () => {
  beforeEach(() => {
    insertMock.mockReset();
    maybePruneEventsForUserMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts an event row with required fields", async () => {
    const { values } = stubPlainInsert([{ id: "new-event" }]);

    await writeEvent({
      userId: "user_abc",
      kind: "ok",
      message: "Record synced",
    });

    expect(insertMock).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith({
      userId: "user_abc",
      kind: "ok",
      message: "Record synced",
      recordUuid: null,
      sourceId: null,
    });
    expect(maybePruneEventsForUserMock).toHaveBeenCalledWith("user_abc");
  });

  it("inserts an event row with optional recordUuid and sourceId", async () => {
    const { values } = stubPlainInsert([{ id: "new-event" }]);

    await writeEvent({
      userId: "user_abc",
      kind: "warn",
      message: "Sync conflict",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });

    expect(values).toHaveBeenCalledWith({
      userId: "user_abc",
      kind: "warn",
      message: "Sync conflict",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });
  });

  it("coerces undefined recordUuid and sourceId to null", async () => {
    const { values } = stubPlainInsert([{ id: "new-event" }]);

    await writeEvent({
      userId: "user_abc",
      kind: "dim",
      message: "Deleted 3 records",
      recordUuid: undefined,
      sourceId: undefined,
    });

    const insertedValues = (
      values.mock.calls[0] as [Record<string, unknown>]
    )[0];

    expect(insertedValues.recordUuid).toBeNull();
    expect(insertedValues.sourceId).toBeNull();
  });

  it("does not target the ON CONFLICT arbiter for a kind outside ok/err", async () => {
    // "dim"/"warn" fall outside the partial index's predicate entirely, so
    // insertEventRow must skip onConflictDoNothing rather than attach a
    // conflict clause that could never match.
    const { values } = stubPlainInsert([{ id: "new-event" }]);

    await writeEvent({
      userId: "user_abc",
      kind: "dim",
      message: "Deleted 3 records",
      recordUuid: "rec-uuid",
    });

    expect(values).toHaveBeenCalledOnce();
    const chain = values.mock.results[0]?.value as Record<string, unknown>;
    expect(chain).not.toHaveProperty("onConflictDoNothing");
  });

  it("targets the ON CONFLICT arbiter when kind is ok/err and recordUuid is set, so a same-kind duplicate is a no-op instead of a raw unique_violation", async () => {
    // This is the structural guard for the invariant documented above
    // writeEvent: the partial unique index constrains the whole table, not
    // just writeEventOncePerRecord, so a second "ok"/"err" for a recordUuid
    // that already has one must resolve to a no-op here too, not a rejection.
    const { onConflictDoNothing, returning } = stubConflictInsert([]);

    await expect(
      writeEvent({
        userId: "user_abc",
        kind: "ok",
        message: "Webhook received: Deploy",
        recordUuid: "rec-uuid",
        sourceId: "src-uuid",
      }),
    ).resolves.toBeUndefined();

    expect(onConflictDoNothing).toHaveBeenCalledOnce();
    expect(returning).toHaveBeenCalledOnce();
    expect(maybePruneEventsForUserMock).not.toHaveBeenCalled();
  });

  it("does not swallow a genuine insert failure (unlike writeEventOncePerRecord)", async () => {
    // writeEvent has no fail-closed catch of its own — a real DB failure must
    // still propagate to the caller exactly as a plain insert always has,
    // since every current caller already wraps writeEvent in its own catch
    // (see server/api/records/index.post.ts, index.delete.ts, index.patch.ts,
    // and server/api/hooks/[slug].post.ts's fresh-insert branch).
    const { returning } = stubConflictInsert([]);
    returning.mockReturnValue(Promise.reject(new Error("connection blip")));

    await expect(
      writeEvent({
        userId: "user_abc",
        kind: "ok",
        message: "Webhook received: Deploy",
        recordUuid: "rec-uuid",
      }),
    ).rejects.toThrow("connection blip");

    expect(maybePruneEventsForUserMock).not.toHaveBeenCalled();
  });
});

describe("writeEventOncePerRecord", () => {
  beforeEach(() => {
    insertMock.mockReset();
    maybePruneEventsForUserMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the event when it is the first of its kind for the record", async () => {
    const { values, onConflictDoNothing, returning } = stubConflictInsert([
      { id: "new-event" },
    ]);

    await writeEventOncePerRecord({
      userId: "user_abc",
      kind: "ok",
      message: "Webhook received: Deploy",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });

    expect(insertMock).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith({
      userId: "user_abc",
      kind: "ok",
      message: "Webhook received: Deploy",
      recordUuid: "rec-uuid",
      sourceId: "src-uuid",
    });
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
    expect(returning).toHaveBeenCalledOnce();
    expect(maybePruneEventsForUserMock).toHaveBeenCalledWith("user_abc");
  });

  it("targets the partial unique index on (record_uuid, kind), scoped to ok/err", async () => {
    const { onConflictDoNothing } = stubConflictInsert([{ id: "new-event" }]);

    await writeEventOncePerRecord({
      userId: "user_abc",
      kind: "err",
      message: "Failed to confirm webhook ingestion",
      recordUuid: "rec-uuid",
    });

    const config = onConflictDoNothing.mock.calls[0]?.[0] as {
      target: unknown[];
      where: SQL;
    };
    expect(config.target).toEqual([events.recordUuid, events.kind]);
    // The predicate is a real drizzle `sql` template (built by
    // eventRecordKindDedupPredicate, shared with the schema's index
    // definition) rather than a mock — render it through the actual Postgres
    // dialect (not a hand-rolled chunk walk) so this asserts the exact SQL
    // text sent to Postgres, since ON CONFLICT resolves its target index by
    // proving this predicate is implied by the index's own WHERE clause.
    const { sql: renderedSql } = new PgDialect().sqlToQuery(config.where);
    expect(renderedSql).toBe(
      `"events"."record_uuid" is not null and "events"."kind" in ('ok', 'err')`,
    );

    // Ties the predicate to the actual applied migration, not just a literal
    // in this test: if a future schema change (a regenerated migration, a
    // hand edit, or a kind added to EVENT_DEDUPED_KINDS without a matching
    // migration) drifts the two apart, this fails here instead of surfacing
    // only as a swallowed 42P10 in production.
    const migrationSql = readFileSync(
      join(
        import.meta.dirname,
        "../../../server/db/migrations/0025_add_events_record_kind_dedup_index.sql",
      ),
      "utf8",
    );
    expect(migrationSql).toContain(renderedSql);
  });

  it("renders the same predicate whether called from the table-builder callback or with the real events table", () => {
    // eventRecordKindDedupPredicate is called two ways: with `table` inside
    // events' own column-builder callback (server/db/schema.ts, before
    // `events` exists) and with the real `events` export from
    // writeEventOncePerRecord above. Both must render identically, since
    // Postgres compares the ON CONFLICT predicate against the index's own.
    const dialect = new PgDialect();
    const fromRealTable = dialect.sqlToQuery(
      eventRecordKindDedupPredicate(events),
    );
    const fromTableShape = dialect.sqlToQuery(
      eventRecordKindDedupPredicate({
        recordUuid: events.recordUuid,
        kind: events.kind,
      }),
    );

    expect(fromTableShape.sql).toBe(fromRealTable.sql);
  });

  it("is a no-op when a duplicate (record_uuid, kind) insert is absorbed by the DB-level unique index", async () => {
    // returning() resolving empty mirrors onConflictDoNothing actually firing
    // at the DB layer for a concurrent duplicate — this is what makes the
    // dedup exact instead of check-then-act.
    const { returning } = stubConflictInsert([]);

    await expect(
      writeEventOncePerRecord({
        userId: "user_abc",
        kind: "ok",
        message: "Webhook received: Deploy",
        recordUuid: "rec-uuid",
        sourceId: "src-uuid",
      }),
    ).resolves.toBeUndefined();

    expect(returning).toHaveBeenCalledOnce();
    expect(maybePruneEventsForUserMock).not.toHaveBeenCalled();
  });

  it("fails closed — a transient insert error is caught and does not reject or prune", async () => {
    // The insert is now the only DB round trip in this path (no separate
    // existence read), so any transient failure surfaces here. This must not
    // reject: for the webhook ingest healing path
    // (server/api/hooks/[slug].post.ts), a rejection here flips an
    // otherwise-healthy record to `error`.
    const { returning } = stubConflictInsert([]);
    returning.mockReturnValue(Promise.reject(new Error("connection blip")));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      writeEventOncePerRecord({
        userId: "user_abc",
        kind: "ok",
        message: "Webhook received: Deploy",
        recordUuid: "rec-uuid",
        sourceId: "src-uuid",
      }),
    ).resolves.toBeUndefined();

    expect(maybePruneEventsForUserMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[eventWriter] deduped event insert failed; skipping the write:",
      ),
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it("fails closed with a distinct log message when the ON CONFLICT arbiter index is missing (42P10)", async () => {
    // Distinguishes "migration 0025 not applied yet" from a generic transient
    // failure, so this specific, self-recovering-on-deploy cause is
    // greppable in logs rather than indistinguishable from any other error.
    const { returning } = stubConflictInsert([]);
    const arbiterMissingError = Object.assign(
      new Error(
        "no unique or exclusion constraint matching the ON CONFLICT specification",
      ),
      { code: "42P10" },
    );
    returning.mockReturnValue(Promise.reject(arbiterMissingError));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      writeEventOncePerRecord({
        userId: "user_abc",
        kind: "ok",
        message: "Webhook received: Deploy",
        recordUuid: "rec-uuid",
        sourceId: "src-uuid",
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("migration 0025 not applied"),
      arbiterMissingError,
    );

    consoleErrorSpy.mockRestore();
  });

  it("rejects a kind outside ok/err, since the partial index does not cover it", async () => {
    stubConflictInsert([{ id: "new-event" }]);

    // `kind` is typed to "ok" | "err" at every real call site; this simulates
    // a caller that bypasses the type (e.g. a dynamic string), which the
    // runtime guard below the type must still catch.
    const kindOutsideDedup = "warn" as unknown as "ok" | "err";

    await expect(
      writeEventOncePerRecord({
        userId: "user_abc",
        kind: kindOutsideDedup,
        message: "Sync conflict",
        recordUuid: "rec-uuid",
      }),
    ).rejects.toThrow("writeEventOncePerRecord only supports kinds: ok, err");

    expect(insertMock).not.toHaveBeenCalled();
  });
});
