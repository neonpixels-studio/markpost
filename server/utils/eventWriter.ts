import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { events, EVENT_KINDS, type EventKind } from "../db/schema";
import { maybePruneEventsForUser } from "./eventRetention";

// Mirrors the partial predicate on events_record_uuid_kind_ok_err_unique
// (server/db/schema.ts) so Postgres can infer the target index for
// onConflictDoNothing below. Must stay in sync with that index's `.where(...)`.
const DEDUPED_EVENT_KINDS: readonly EventKind[] = ["ok", "err"];

export type WriteEventInput = {
  userId: string;
  kind: EventKind;
  message: string;
  recordUuid?: string | null;
  sourceId?: string | null;
};

function isValidKind(value: string): value is EventKind {
  return (EVENT_KINDS as readonly string[]).includes(value);
}

export function validateEventKind(value: string): EventKind {
  if (!isValidKind(value)) {
    throw new Error(
      `Invalid event kind: "${value}". Must be one of: ${EVENT_KINDS.join(", ")}`,
    );
  }

  return value;
}

export async function writeEvent(input: WriteEventInput): Promise<void> {
  const validatedKind = validateEventKind(input.kind);
  const db = getDb();

  await db.insert(events).values({
    userId: input.userId,
    kind: validatedKind,
    message: input.message,
    recordUuid: input.recordUuid ?? null,
    sourceId: input.sourceId ?? null,
  });

  // Opportunistically enforce retention so the highest-write table stays
  // bounded without a scheduled job (see eventRetention.ts). Best-effort — it
  // never throws, so it cannot fail the event that was just written.
  await maybePruneEventsForUser(input.userId);
}

function isDedupedKind(kind: EventKind): boolean {
  return (DEDUPED_EVENT_KINDS as readonly string[]).includes(kind);
}

// Mirrors the partial predicate on events_record_uuid_kind_ok_err_unique
// exactly (see server/db/schema.ts) — Postgres infers the ON CONFLICT target
// index by matching this expression against the index's own WHERE clause, so
// the two must stay textually in sync.
function dedupIndexPredicate() {
  return sql`${events.recordUuid} is not null and ${events.kind} in ('ok', 'err')`;
}

// Exact dedup for callers that may re-run a side effect (e.g. a webhook
// provider retry that heals a crash between the record insert and its side
// effects). Dedupes by (record, kind) at the DB layer: the insert targets the
// partial unique index on events(record_uuid, kind) (ok/err only) with
// onConflictDoNothing, so two concurrent writers racing the same
// (recordUuid, kind) can never both land a row — one wins, the other is a
// no-op. This replaces the earlier check-then-act (a read followed by an
// insert), which left a race window where both writers could observe "absent"
// and both insert, producing a duplicate.
//
// Requires a recordUuid — that is the dedup key, so a null/absent one would
// defeat the guard. Restricted to "ok"/"err": those are the only kinds this
// dedup applies to (dim/warn may legitimately repeat), matching the partial
// index's predicate.
export async function writeEventOncePerRecord(
  input: WriteEventInput & { recordUuid: string },
): Promise<void> {
  const validatedKind = validateEventKind(input.kind);

  if (!isDedupedKind(validatedKind)) {
    throw new Error(
      `writeEventOncePerRecord only supports kinds: ${DEDUPED_EVENT_KINDS.join(", ")}. Got "${validatedKind}".`,
    );
  }

  const db = getDb();
  const [inserted] = await db
    .insert(events)
    .values({
      userId: input.userId,
      kind: validatedKind,
      message: input.message,
      recordUuid: input.recordUuid,
      sourceId: input.sourceId ?? null,
    })
    .onConflictDoNothing({
      target: [events.recordUuid, events.kind],
      where: dedupIndexPredicate(),
    })
    .returning({ id: events.id });

  if (!inserted) {
    return;
  }

  // Opportunistically enforce retention so the highest-write table stays
  // bounded without a scheduled job (see eventRetention.ts). Best-effort — it
  // never throws, so it cannot fail the event that was just written. Skipped
  // on a conflict no-op above since no event was written.
  await maybePruneEventsForUser(input.userId);
}
