import { createHmac } from "crypto";
import { isIPv4, isIPv6 } from "node:net";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { authFailureThrottle } from "../db/schema";
import {
  buildWindowResetSet,
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
const IPV4_MAPPED_IPV6_PREFIX = "::ffff:";
// A single IPv6 customer (residential or mobile) is typically handed a /64
// block and can rotate freely through the remaining 64 bits (privacy
// extensions, per-device addressing) — keying on the full address would let
// one attacker mint a fresh throttle bucket on every guess. 4 groups of 16
// bits each = 64 bits.
const IPV6_THROTTLE_PREFIX_GROUPS = 4;

// Logged once at module load, not per-request: a missing pepper does not
// break the limiter (hashIp still works, see below), but it does silently
// downgrade its stored key from "not practically reversible" to "reversible
// by brute force in minutes", which is worth a loud, one-time signal in
// production logs/Sentry rather than staying invisible.
if (
  process.env.NODE_ENV === "production" &&
  !process.env.AUTH_THROTTLE_IP_PEPPER
) {
  console.error(
    "[authFailureThrottle] AUTH_THROTTLE_IP_PEPPER is unset in production — " +
      "the failed-auth IP throttle's stored hash is reversible by brute " +
      "force (see .env.example).",
  );
}

// Expands the `::` zero-compression shorthand so the address can be sliced
// by group index. Does not handle a zone id (`%eth0`) or an IPv4 embedded in
// a form other than the `::ffff:` prefix (handled separately in
// throttleKeyForIp) — neither is a shape getRequestIP or Netlify's
// x-nf-client-connection-ip header produce.
function expandIpv6Groups(address: string): string[] {
  const [head, tail] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missingGroups = 8 - headGroups.length - tailGroups.length;
  return [
    ...headGroups,
    ...new Array(Math.max(missingGroups, 0)).fill("0"),
    ...tailGroups,
  ];
}

// Normalizes an address to the key it should be throttled under: an IPv4
// address (including one embedded in an IPv4-mapped IPv6 address) as-is, or
// an IPv6 address truncated to its /64 prefix. See the const comments above
// for why bucketing matters for IPv6 specifically.
export function throttleKeyForIp(ipAddress: string): string {
  if (isIPv4(ipAddress)) {
    return ipAddress;
  }

  const lowered = ipAddress.toLowerCase();
  if (lowered.startsWith(IPV4_MAPPED_IPV6_PREFIX)) {
    const embeddedIpv4 = ipAddress.slice(IPV4_MAPPED_IPV6_PREFIX.length);
    if (isIPv4(embeddedIpv4)) {
      return embeddedIpv4;
    }
  }

  if (!isIPv6(ipAddress)) {
    return ipAddress;
  }

  const groups = ipAddress.includes("::")
    ? expandIpv6Groups(ipAddress)
    : ipAddress.split(":");
  return groups.slice(0, IPV6_THROTTLE_PREFIX_GROUPS).join(":");
}

// Only equality matching is needed to key the fixed-window counter, so a
// one-way hash of the normalized key is stored instead of the raw client IP.
// Mixes in an optional server-side pepper (read fresh on every call, not
// cached at module load, so tests can flip it and so can a runtime env
// change): without it, this hash is only casual obfuscation, since the
// entire IPv4 space is a few billion values and a bare hash of one is
// reversible by brute force in minutes. See the module-load warning above
// and .env.example for where to generate one.
function hashIp(ipAddress: string): string {
  const pepper = process.env.AUTH_THROTTLE_IP_PEPPER ?? "";
  return createHmac(IP_HASH_ALGORITHM, pepper)
    .update(throttleKeyForIp(ipAddress))
    .digest("hex");
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
// throttle state, and a future attempt from that IP just re-inserts a fresh
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
// first reservation, so this is an INSERT ... ON CONFLICT DO UPDATE: the
// insert path seeds a fresh row (windowStart defaults to the database's own
// now(), not the app server's clock — the ON CONFLICT path's CASE reset
// already compares against the database's now(), and stamping the two paths
// from different clocks would let clock skew between the Netlify function
// and Postgres shorten or lengthen a window depending on which path a
// request happens to take), and the conflict path reuses the same
// window-expiry CASE logic (buildWindowResetSet) as the other two throttles.
// Because Postgres serializes concurrent UPDATEs to the same row, N
// simultaneous requests from one IP each get a distinct, correctly
// incremented count back from this single statement — there is no
// read-then-write gap for concurrent guesses to race through. A write
// failure here is the limiter's own infrastructure breaking, not a signal
// about the caller, so it fails open (not throttled) rather than turning a
// transient DB hiccup into every login attempt being blocked.
async function reserveAndFetchCounter(
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
      "[authFailureThrottle] failed to reserve an auth attempt",
      error,
    );
    return null;
  }
}

// Atomically reserves one unit of an IP's failed-auth budget and reports
// whether it is still within budget — call this *before* attempting to
// verify a presented credential (server/middleware/auth.ts), not after a
// failure, so an IP that has already exhausted its budget is rejected before
// any Clerk/DB work runs to check whether this particular guess happens to
// be correct. A read-then-write pre-check (checking, then only recording on
// failure) cannot close this gap under concurrency: Netlify runs function
// invocations in parallel, so a burst of simultaneous guesses would all read
// "under budget" before any of them had recorded a failure. Reserving
// up-front means every attempt (successful or not) spends budget the moment
// it is made; refundAuthAttempt below gives a *successful* attempt its
// budget back so legitimate use does not erode the guessing budget over
// time.
export async function reserveAuthAttempt(
  ipAddress: string,
): Promise<ThrottleResult> {
  const counter = await reserveAndFetchCounter(hashIp(ipAddress));

  return evaluateThrottleCounter(
    counter,
    AUTH_FAILURE_THROTTLE_MAX_HITS,
    AUTH_FAILURE_THROTTLE_WINDOW_SECONDS,
  );
}

// Gives back the budget unit reserveAuthAttempt spent, once verification
// turns out to have succeeded — so a legitimate, repeatedly-used API token
// nets out to roughly zero spent budget instead of slowly using up the same
// pool a guessing loop needs to trip. Floored at 0 (GREATEST) so a burst of
// refunds racing a fresh window's reset can never drive the count negative.
// Best-effort: the caller has already gotten its successful response by the
// time this runs, so a failure here just leaves one extra count sitting in
// the window rather than failing the request — it fails silently (logged,
// not surfaced) rather than turning a refund hiccup into a user-visible
// error for a request that already succeeded.
export async function refundAuthAttempt(ipAddress: string): Promise<void> {
  try {
    const database = getDb();
    await database
      .update(authFailureThrottle)
      .set({ count: sql`GREATEST(${authFailureThrottle.count} - 1, 0)` })
      .where(eq(authFailureThrottle.ipHash, hashIp(ipAddress)));
  } catch (error) {
    console.error(
      "[authFailureThrottle] failed to refund a successful auth attempt",
      error,
    );
  }
}
