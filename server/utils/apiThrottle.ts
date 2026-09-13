import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { throwUnauthorized } from "./errors";
import {
  evaluateThrottleCounter,
  windowExpiredCondition,
  type ThrottleResult,
} from "./fixedWindowThrottle";

// Throttles every authenticated /api/* request (the auth middleware calls
// this once per request, keyed by the resolved userId — see
// server/middleware/auth.ts). Keyed by userId rather than by API token or
// Clerk session so a stolen bearer token can't dodge the limit by minting a
// fresh token, and so a Clerk session and an API token for the same user
// share one budget. 300 requests/60s (~5rps sustained) comfortably covers
// normal UI and CLI usage (individual record reads/writes) while still
// bounding a stolen-token flood; see webhookThrottle.ts for why this is a
// fixed window rather than sliding/leaky-bucket.
export const API_THROTTLE_WINDOW_SECONDS = 60;
export const API_THROTTLE_MAX_HITS = 300;

type ThrottleCounterRow = {
  apiThrottleCount: number;
  apiThrottleWindowStart: Date;
};

// Distinguishes "the update ran and found no row" (a real, if rare, signal —
// see the comment on recordAuthedApiHit) from "the update itself failed" (an
// infrastructure hiccup unrelated to who the caller is). Collapsing those two
// into a single `null` would make a transient DB error 401 every authenticated
// request in flight, instead of the fail-open behavior a rate limiter's own
// failure should get.
type CounterOutcome =
  | { status: "ok"; counter: ThrottleCounterRow }
  | { status: "not-found" }
  | { status: "error" };

async function recordHitAndFetchCounter(
  userId: string,
): Promise<CounterOutcome> {
  const database = getDb();
  const windowExpired = windowExpiredCondition(
    users.apiThrottleWindowStart,
    API_THROTTLE_WINDOW_SECONDS,
  );

  try {
    const [row] = await database
      .update(users)
      .set({
        apiThrottleWindowStart: sql`CASE WHEN ${windowExpired} THEN now() ELSE ${users.apiThrottleWindowStart} END`,
        apiThrottleCount: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${users.apiThrottleCount} + 1 END`,
      })
      .where(eq(users.userId, userId))
      .returning({
        apiThrottleCount: users.apiThrottleCount,
        apiThrottleWindowStart: users.apiThrottleWindowStart,
      });

    return row ? { status: "ok", counter: row } : { status: "not-found" };
  } catch (error) {
    console.error(
      "[apiThrottle] failed to record authenticated API hit",
      error,
    );
    return { status: "error" };
  }
}

// Records this hit against the user's fixed window and reports whether it is
// within the allowed rate. Isolated from the middleware so it can be
// unit-tested against a mocked db independently of auth/session handling.
//
// A "not-found" outcome deliberately does NOT reuse webhookThrottle's "no row
// -> allowed" fallback: there, a deleted source's own 404 handling takes over
// downstream, so letting that one request through unthrottled is harmless.
// Here nothing downstream catches it. In practice this branch should be
// unreachable: the auth middleware's ensureUserRegistered already
// re-inserts the row on the Clerk path before this runs, and an API token's
// FK cascade means a deleted user has no tokens left to authenticate with in
// the first place — so this is a belt-and-braces guard against the
// microsecond-wide race between that insert and this UPDATE (or a future
// caller of recordAuthedApiHit that skips ensureUserRegistered), not a path
// exercised in normal operation. Failing closed rather than allowed keeps
// that guard meaningful: silently allowing it would hand an edge-case
// request an unbounded budget instead. An "error" outcome (the write itself
// failed) is the opposite case: that's the limiter breaking, not the caller
// being invalid, so it fails open rather than turning a database hiccup into
// an outage for every authenticated endpoint.
export async function recordAuthedApiHit(
  userId: string,
): Promise<ThrottleResult> {
  const outcome = await recordHitAndFetchCounter(userId);

  if (outcome.status === "error") {
    return { allowed: true };
  }

  if (outcome.status === "not-found") {
    throwUnauthorized();
  }

  return evaluateThrottleCounter(
    {
      count: outcome.counter.apiThrottleCount,
      windowStart: outcome.counter.apiThrottleWindowStart,
    },
    API_THROTTLE_MAX_HITS,
    API_THROTTLE_WINDOW_SECONDS,
  );
}
