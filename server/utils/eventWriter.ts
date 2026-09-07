import { getDb } from "../db";
import {
  events,
  EVENT_KINDS,
  EVENT_DEDUPED_KINDS,
  eventRecordKindDedupPredicate,
  type EventKind,
} from "../db/schema";
import { maybePruneEventsForUser } from "./eventRetention";

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

function isDedupedKind(kind: EventKind): boolean {
  return (EVENT_DEDUPED_KINDS as readonly string[]).includes(kind);
}

// Shared insert payload shape for both write paths below, so a future field
// change (e.g. message truncation) can't land in one and silently miss the
// other.
function buildEventRow(input: WriteEventInput, kind: EventKind) {
  return {
    userId: input.userId,
    kind,
    message: input.message,
    recordUuid: input.recordUuid ?? null,
    sourceId: input.sourceId ?? null,
  };
}

export async function writeEvent(input: WriteEventInput): Promise<void> {
  const validatedKind = validateEventKind(input.kind);
  const db = getDb();

  await db.insert(events).values(buildEventRow(input, validatedKind));

  // Opportunistically enforce retention so the highest-write table stays
  // bounded without a scheduled job (see eventRetention.ts). Best-effort — it
  // never throws, so it cannot fail the event that was just written.
  await maybePruneEventsForUser(input.userId);
}

// Exact dedup for callers that may re-run a side effect (e.g. a webhook
// provider retry that heals a crash between the record insert and its side
// effects). Dedupes by (record, kind) at the DB layer: the insert targets the
// partial unique index on events(record_uuid, kind) (ok/err only, see
// migration 0025 and eventRecordKindDedupPredicate in server/db/schema.ts)
// with onConflictDoNothing, so two concurrent writers racing the same
// (recordUuid, kind) can never both land a row — one wins, the other is a
// no-op. This replaces the earlier check-then-act (a read followed by an
// insert), which left a race window where both writers could observe "absent"
// and both insert, producing a duplicate.
//
// Requires a recordUuid — that is the dedup key, so a null/absent one would
// defeat the guard. Restricted to "ok"/"err": those are the only kinds this
// dedup applies to (dim/warn may legitimately repeat), matching the partial
// index's predicate.
//
// Fails CLOSED: if the insert itself throws (a transient DB blip, or the app
// deploying before migration 0025 lands the arbiter index — Postgres 42P10
// "no unique or exclusion constraint matching the ON CONFLICT specification"),
// log and return rather than reject. This mirrors the previous contract on
// the old check-then-act's read step: the caller here is always the webhook
// ingest flow's healing path (server/api/hooks/[slug].post.ts), where a
// rejection propagates into recordIngestEventFailure and flips an
// otherwise-healthy record to `error` over a failed *log write*, not a real
// ingest failure. Skipping instead risks only a missing activity event on the
// rare heal; the recordCount counter is guarded independently (by the
// record's counted_at claim), so it is never mis-counted.
export async function writeEventOncePerRecord(
  input: WriteEventInput & { recordUuid: string },
): Promise<void> {
  const validatedKind = validateEventKind(input.kind);

  if (!isDedupedKind(validatedKind)) {
    throw new Error(
      `writeEventOncePerRecord only supports kinds: ${EVENT_DEDUPED_KINDS.join(", ")}. Got "${validatedKind}".`,
    );
  }

  const db = getDb();
  const inserted = await db
    .insert(events)
    .values(buildEventRow(input, validatedKind))
    .onConflictDoNothing({
      target: [events.recordUuid, events.kind],
      where: eventRecordKindDedupPredicate(events),
    })
    .returning({ id: events.id })
    .catch((insertError) => {
      console.error(
        "[eventWriter] deduped event insert failed; skipping the write:",
        insertError,
      );
      return [];
    });

  if (inserted.length === 0) {
    return;
  }

  await maybePruneEventsForUser(input.userId);
}
