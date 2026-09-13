import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
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

async function recordHitAndFetchCounter(
  userId: string,
): Promise<ThrottleCounterRow | null> {
  const database = getDb();
  const windowExpired = windowExpiredCondition(
    users.apiThrottleWindowStart,
    API_THROTTLE_WINDOW_SECONDS,
  );

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

  return row ?? null;
}

// Records this hit against the user's fixed window and reports whether it is
// within the allowed rate. Isolated from the middleware so it can be
// unit-tested against a mocked db independently of auth/session handling.
export async function recordAuthedApiHit(
  userId: string,
): Promise<ThrottleResult> {
  const counter = await recordHitAndFetchCounter(userId);

  return evaluateThrottleCounter(
    counter
      ? {
          count: counter.apiThrottleCount,
          windowStart: counter.apiThrottleWindowStart,
        }
      : null,
    API_THROTTLE_MAX_HITS,
    API_THROTTLE_WINDOW_SECONDS,
  );
}
