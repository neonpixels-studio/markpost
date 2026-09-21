import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { authFailureThrottle } from "../db/schema";
import {
  evaluateThrottleCounter,
  windowExpiredCondition,
  type ThrottleResult,
} from "./fixedWindowThrottle";

// Bounds a bad-token guessing loop from a single IP: enough budget for a
// human mistyping/re-pasting a token a few times, tight enough to make
// brute-forcing a token infeasible within a window. Deliberately much
// tighter than API_THROTTLE_MAX_HITS (apiThrottle.ts, 300/60s) — that limiter
// bounds normal authenticated traffic, this one exists specifically to
// starve a guessing loop, so it stays low regardless of legitimate request
// volume.
export const AUTH_FAILURE_THROTTLE_WINDOW_SECONDS = 60;
export const AUTH_FAILURE_THROTTLE_MAX_HITS = 10;

const IP_HASH_ALGORITHM = "sha256";

// Only equality matching is needed to key the fixed-window counter, so a
// one-way hash is stored instead of the raw client IP — no reversible PII at
// rest for what is otherwise a throwaway counter.
function hashIp(ipAddress: string): string {
  return createHash(IP_HASH_ALGORITHM).update(ipAddress).digest("hex");
}

type ThrottleCounterRow = {
  count: number;
  windowStart: Date;
};

// Isolated from the middleware so the atomic upsert can be unit-tested
// against a mocked db independently of request/IP resolution. Unlike
// apiThrottle/webhookThrottle, which UPDATE a row that is guaranteed to
// already exist (a user or a source), no row exists for an IP until its
// first failure, so this is an INSERT ... ON CONFLICT DO UPDATE: the insert
// path seeds count 1 on a brand-new IP, and the conflict path reuses the
// same window-expiry CASE logic as the other two throttles to either reset
// or increment. A write failure here is the limiter's own infrastructure
// breaking, not a signal about the caller, so it fails open (not throttled)
// rather than turning a transient DB hiccup into every failed login being
// blocked — the caller still gets its normal 401 either way.
async function recordFailureAndFetchCounter(
  ipHash: string,
): Promise<ThrottleCounterRow | null> {
  const database = getDb();
  const windowExpired = windowExpiredCondition(
    authFailureThrottle.windowStart,
    AUTH_FAILURE_THROTTLE_WINDOW_SECONDS,
  );

  try {
    const [row] = await database
      .insert(authFailureThrottle)
      .values({ ipHash, windowStart: new Date(), count: 1 })
      .onConflictDoUpdate({
        target: authFailureThrottle.ipHash,
        set: {
          windowStart: sql`CASE WHEN ${windowExpired} THEN now() ELSE ${authFailureThrottle.windowStart} END`,
          count: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${authFailureThrottle.count} + 1 END`,
        },
      })
      .returning({
        count: authFailureThrottle.count,
        windowStart: authFailureThrottle.windowStart,
      });

    return row ?? null;
  } catch (error) {
    console.error(
      "[authFailureThrottle] failed to record failed auth attempt",
      error,
    );
    return null;
  }
}

// Records a failed authentication attempt against the caller IP's fixed
// window and reports whether it is still within budget. Call this ahead of
// throwUnauthorized() for every path that rejects a request as
// unauthenticated (missing token, invalid/expired token, unresolvable
// session) — never for a successful auth, so a legitimate high-volume caller
// never burns this budget.
export async function recordAuthFailure(
  ipAddress: string,
): Promise<ThrottleResult> {
  const counter = await recordFailureAndFetchCounter(hashIp(ipAddress));

  return evaluateThrottleCounter(
    counter,
    AUTH_FAILURE_THROTTLE_MAX_HITS,
    AUTH_FAILURE_THROTTLE_WINDOW_SECONDS,
  );
}
