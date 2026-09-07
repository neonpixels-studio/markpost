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

// The partial unique index on events(record_uuid, kind) (migration 0025)
// constrains the table, not just writeEventOncePerRecord below: a plain
// writeEvent that inserts a second "ok" or "err" for a recordUuid that
// already has one hits a real 23505 unique-violation and rejects like any
// other insert failure. No current caller can trigger this — every writeEvent
// call with kind ok/err targets a recordUuid on the request that just created
// it, so it is always that record's first ok/err event — but a future ok/err
// writeEvent call for an existing record's uuid must go through
// writeEventOncePerRecord instead, or it will throw where it previously
// silently duplicated.
export async function writeEvent(input: WriteEventInput): Promise<void> {
  const validatedKind = validateEventKind(input.kind);
  const db = getDb();

  await db.insert(events).values(buildEventRow(input, validatedKind));

  // Opportunistically enforce retention so the highest-write table stays
  // bounded without a scheduled job (see eventRetention.ts). Best-effort — it
  // never throws, so it cannot fail the event that was just written.
  await maybePruneEventsForUser(input.userId);
}

type DedupedEventKind = (typeof EVENT_DEDUPED_KINDS)[number];

function isDedupedKind(kind: EventKind): boolean {
  return (EVENT_DEDUPED_KINDS as readonly string[]).includes(kind);
}

// Postgres SQLSTATE raised when an ON CONFLICT target can't be resolved to a
// real arbiter index/constraint — the app deploying before migration 0025
// lands events_record_uuid_kind_ok_err_unique. Distinguished from other insert
// failures (a transient DB blip) only so the log line names the actual cause;
// both are handled identically (skip the write) since either way there is no
// safe way to enforce the dedup for this write. Matches the shallow
// `(error as { code }).code` pattern already used in
// server/api/sources/index.post.ts (not the deeper `cause`-chain walk in
// filePathCollision.ts, which exists to identify one specific constraint by
// name — this only needs to distinguish one SQLSTATE for a log message).
const ARBITER_INDEX_MISSING_SQLSTATE = "42P10";

function describeInsertFailure(insertError: unknown): string {
  const code = (insertError as { code?: string } | null)?.code;

  if (code === ARBITER_INDEX_MISSING_SQLSTATE) {
    return "[eventWriter] deduped event insert failed: ON CONFLICT arbiter index missing (migration 0025 not applied?); skipping the write";
  }

  return "[eventWriter] deduped event insert failed; skipping the write:";
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
// defeat the guard. `kind` is typed to ok/err only (the only kinds the
// partial index covers; dim/warn may legitimately repeat) so a wrong-kind call
// is a compile-time error at every call site; the runtime check below is a
// defense-in-depth guard against a caller that bypasses the type (e.g. a
// dynamic string), and intentionally throws rather than failing closed — a
// caller-contract violation is a programmer bug that must surface loudly, not
// be silently absorbed by the DB-failure handling below.
//
// Fails CLOSED on the insert itself: a transient DB blip, or the app
// deploying before migration 0025 lands the arbiter index, is logged and
// skipped rather than rejected. This mirrors the previous contract on the old
// check-then-act's read step: the caller here is always the webhook ingest
// flow's healing path (server/api/hooks/[slug].post.ts), where a rejection
// propagates into recordIngestEventFailure and flips an otherwise-healthy
// record to `error` over a failed *log write*, not a real ingest failure.
// Skipping instead risks only a missing activity event on the rare heal; the
// recordCount counter is guarded independently (by the record's counted_at
// claim), so it is never mis-counted.
export async function writeEventOncePerRecord(
  input: WriteEventInput & { recordUuid: string; kind: DedupedEventKind },
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
      console.error(describeInsertFailure(insertError), insertError);
      return [];
    });

  if (inserted.length === 0) {
    return;
  }

  await maybePruneEventsForUser(input.userId);
}
