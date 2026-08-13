import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../db";
import { events } from "../db/schema";

// The events table is the highest-write table in the app (one row per webhook
// ingest, record create, and bulk delete) and has no natural upper bound, so
// left alone it dominates storage and cost over time. Retention drops each
// user's activity older than EVENT_RETENTION_DAYS.
//
// This deployment is serverless (Netlify) with no scheduled-job runner, so
// there is nowhere to hang a nightly cron. Instead pruning is opportunistic: a
// small fraction of writes trigger a sweep for the user that just wrote (like
// PHP's session garbage collector, which gc's on a probability rather than on a
// timer). Each sweep deletes at most EVENT_PRUNE_BATCH_SIZE rows, oldest first,
// so the work on any single request stays bounded even on the first pass over a
// large backlog; repeated draws drain the remainder incrementally. Scoping the
// sweep to the writing user keeps the delete on the (user_id, ts) index and
// targets the active, high-write accounts that actually drive growth — an idle
// account stops adding rows too, so it stops driving growth.
export const EVENT_RETENTION_DAYS = 90;
export const EVENT_PRUNE_PROBABILITY = 0.01;
export const EVENT_PRUNE_BATCH_SIZE = 1000;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - EVENT_RETENTION_DAYS * MILLISECONDS_PER_DAY);
}

export function shouldPrune(sample: number = Math.random()): boolean {
  return sample < EVENT_PRUNE_PROBABILITY;
}

export async function pruneEventsForUser(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const db = getDb();
  const cutoff = retentionCutoff(now);

  // Bound the sweep with an ordered, LIMITed subquery so a single invocation
  // never deletes an unbounded backlog in one statement, and drains the oldest
  // rows first.
  const expiredIds = db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.userId, userId), lt(events.ts, cutoff)))
    .orderBy(events.ts)
    .limit(EVENT_PRUNE_BATCH_SIZE);

  // Keep the user predicate on the DELETE itself (not only the subquery) so a
  // future edit to the subquery can never widen this into a cross-tenant wipe.
  const result = await db
    .delete(events)
    .where(and(eq(events.userId, userId), inArray(events.id, expiredIds)));

  return result.rowCount ?? 0;
}

// Best-effort: gated by the prune probability and never allowed to throw, so a
// retention failure can never break the write that triggered it.
export async function maybePruneEventsForUser(userId: string): Promise<void> {
  if (!shouldPrune()) {
    return;
  }

  const pruned = await pruneEventsForUser(userId).catch((pruneError) => {
    console.error(
      `[eventRetention] failed to prune events for user ${userId}:`,
      pruneError,
    );
    return 0;
  });

  if (pruned > 0) {
    // Debug, not info: this runs on the hottest write path, so keep it out of
    // the default log volume while still leaving a signal that retention works.
    console.debug(
      `[eventRetention] pruned ${pruned} event(s) past retention for user ${userId}`,
    );
  }
}
