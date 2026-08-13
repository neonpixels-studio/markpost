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
