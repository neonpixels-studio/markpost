import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { events, EVENT_KINDS, type EventKind } from "../db/schema";
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

// Fails CLOSED: on any read error, log and return true ("assume already
// logged"), so the caller skips the write rather than attempting it. This never
// rejects. Failing open would be worse than it looks: the dedup read and the
// follow-up write share a connection, so a transient failure hits both — the
// write then rejects into the caller's error path, which for the webhook ingest
// flow flips an otherwise-healthy record to `error`. Skipping instead risks only
// a missing activity event on the rare heal; the recordCount counter is guarded
// independently (by the record's counted_at claim), so it is never mis-counted.
async function eventAlreadyLoggedForRecord(
  recordUuid: string,
  kind: EventKind,
): Promise<boolean> {
  const db = getDb();
  try {
    const [existing] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.recordUuid, recordUuid), eq(events.kind, kind)))
      .limit(1);

    return Boolean(existing);
  } catch (lookupError) {
    console.error(
      "[eventWriter] event existence check failed; skipping the write:",
      lookupError,
    );
    return true;
  }
}

// Best-effort dedup for callers that may re-run a side effect (e.g. a webhook
// provider retry that heals a crash between the record insert and its side
// effects). Dedupes by (record, kind): if an event of this kind already exists
// for the record, the write is skipped, so a sequential retry is a no-op while a
// genuinely first write still lands. Requires a recordUuid — that is the dedup
// key, so a null/absent one would defeat the guard. Because the existence check
// fails closed (skips on read error), the only failure this propagates is a real
// write failure.
//
// This is check-then-act, not atomic: two concurrent writers can both read
// "absent" and both insert, so under genuine concurrency it can still emit a
// duplicate — a cosmetic extra activity-log entry, never a mis-count (the
// counter is guarded separately by the record's counted_at claim). A partial
// unique index on (record_uuid, kind) plus onConflictDoNothing would make it
// exact and is tracked as a follow-up.
export async function writeEventOncePerRecord(
  input: WriteEventInput & { recordUuid: string },
): Promise<void> {
  const alreadyLogged = await eventAlreadyLoggedForRecord(
    input.recordUuid,
    input.kind,
  );

  if (alreadyLogged) {
    return;
  }

  await writeEvent(input);
}
