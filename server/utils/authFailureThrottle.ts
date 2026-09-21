import { createHmac } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { authFailureThrottle } from "../db/schema";
import {
  buildWindowResetSet,
  evaluateThrottleCounter,
  isWindowExpired,
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
// one-way hash is stored instead of the raw client IP. Mixes in an optional
// server-side pepper (read fresh on every call, not cached at module load,
// so tests can flip it and — in principle — so can a runtime env change):
// without it, this hash is only casual obfuscation, since the entire IPv4
// space is a few billion values and a bare hash of one (salted or not, since
// a "salt" would need to be public to be useful for lookups) is reversible
// by brute force in minutes. Setting AUTH_THROTTLE_IP_PEPPER makes the hash
// infeasible to reverse without also knowing the pepper. See .env.example
// for where to generate one.
function hashIp(ipAddress: string): string {
  const pepper = process.env.AUTH_THROTTLE_IP_PEPPER ?? "";
  return createHmac(IP_HASH_ALGORITHM, pepper).update(ipAddress).digest("hex");
}

type ThrottleCounterRow = {
  count: number;
  windowStart: Date;
};

// Runs on a small fraction of writes rather than a scheduled job (this repo
// has no cron infrastructure) so auth_failure_throttle does not grow without
// bound as distinct IPs fail auth over time — every write is a candidate
// trigger, so the table self-trims under real traffic without needing an
// external scheduler. A row whose window has already expired is safe to
// delete unconditionally: the same window-expiry condition that would have
// reset it in place (see buildWindowResetSet) means it carries no live
// throttle state, and a future failure from that IP just re-inserts a fresh
// row. Failure here is logged and swallowed — a missed prune delays cleanup,
// it does not change whether any request is allowed or denied.
const PRUNE_PROBABILITY = 0.01;

async function pruneExpiredRows(): Promise<void> {
  if (Math.random() >= PRUNE_PROBABILITY) {
    return;
  }

  try {
    const database = getDb();
    await database
      .delete(authFailureThrottle)
      .where(
        windowExpiredCondition(
          authFailureThrottle.windowStart,
          AUTH_FAILURE_THROTTLE_WINDOW_SECONDS,
        ),
      );
  } catch (error) {
    console.error("[authFailureThrottle] failed to prune expired rows", error);
  }
}

// Isolated from the middleware so the atomic upsert can be unit-tested
// against a mocked db independently of request/IP resolution. Unlike
// apiThrottle/webhookThrottle, which UPDATE a row that is guaranteed to
// already exist (a user or a source), no row exists for an IP until its
// first failure, so this is an INSERT ... ON CONFLICT DO UPDATE: the insert
// path seeds a fresh row (windowStart defaults to the database's own now(),
// not the app server's clock — the ON CONFLICT path's CASE reset already
// compares against the database's now(), and stamping the two paths from
// different clocks would let clock skew between the Netlify function and
// Postgres shorten or lengthen a window depending on which path a request
// happens to take), and the conflict path reuses the same window-expiry
// CASE logic (buildWindowResetSet) as the other two throttles. A write
// failure here is the limiter's own infrastructure breaking, not a signal
// about the caller, so it fails open (not throttled) rather than turning a
// transient DB hiccup into every failed login being blocked — the caller
// still gets its normal 401 either way (see server/middleware/auth.ts).
async function recordFailureAndFetchCounter(
  ipHash: string,
): Promise<ThrottleCounterRow | null> {
  try {
    const database = getDb();
    const resetSet = buildWindowResetSet(
      authFailureThrottle.windowStart,
      authFailureThrottle.count,
      AUTH_FAILURE_THROTTLE_WINDOW_SECONDS,
    );

    const [row] = await database
      .insert(authFailureThrottle)
      .values({ ipHash, count: 1 })
      .onConflictDoUpdate({
        target: authFailureThrottle.ipHash,
        set: resetSet,
      })
      .returning({
        count: authFailureThrottle.count,
        windowStart: authFailureThrottle.windowStart,
      });

    await pruneExpiredRows();

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
// window and reports whether it is still within budget. Call this only after
// authentication has actually failed (missing/invalid/expired token or
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

// Read-only check for whether an IP is *currently* throttled, without
// spending any budget. Call this before attempting to verify a presented
// token/session, so an IP that has already exhausted its budget is rejected
// before the middleware does any Clerk/DB work to check whether this
// particular guess happens to be correct — recordAuthFailure alone (only
// called after a failed verification) cannot do this, since by construction
// it never runs before verification has already completed. Without this
// pre-check, an over-budget IP would still get a verification result for
// every request (a correct guess would still authenticate, and an incorrect
// one would merely trade a 401 for a 429), which defeats the point of
// throttling a guessing loop. A row is intentionally not treated as
// throttled once its window has expired, even though its stored count may
// still read over the limit — nothing has reset it server-side yet (that
// only happens on the next write, via buildWindowResetSet's CASE), so
// isWindowExpired reproduces that same reset decision on the read side.
export async function isAuthFailureThrottled(
  ipAddress: string,
): Promise<ThrottleResult> {
  try {
    const database = getDb();
    const [row] = await database
      .select({
        count: authFailureThrottle.count,
        windowStart: authFailureThrottle.windowStart,
      })
      .from(authFailureThrottle)
      .where(eq(authFailureThrottle.ipHash, hashIp(ipAddress)))
      .limit(1);

    if (
      !row ||
      isWindowExpired(row.windowStart, AUTH_FAILURE_THROTTLE_WINDOW_SECONDS)
    ) {
      return { allowed: true };
    }

    return evaluateThrottleCounter(
      row,
      AUTH_FAILURE_THROTTLE_MAX_HITS,
      AUTH_FAILURE_THROTTLE_WINDOW_SECONDS,
    );
  } catch (error) {
    console.error(
      "[authFailureThrottle] failed to check failed-auth throttle state",
      error,
    );
    return { allowed: true };
  }
}
