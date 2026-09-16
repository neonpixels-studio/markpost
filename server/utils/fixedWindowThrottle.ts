import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// Shared building blocks for every fixed-window rate limiter in this codebase
// (webhookThrottle.ts keyed on a source row, apiThrottle.ts keyed on a user
// row): each limiter still owns its own atomic UPDATE...RETURNING against its
// own table/columns (drizzle column references can't be made generic across
// tables), but the window-expiry condition and the allow/deny decision are
// identical logic and are isolated here so they're defined and tested once.
export type ThrottleResult =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

export type FixedWindowCounter = {
  count: number;
  windowStart: Date;
};

// True once `windowStartColumn` is more than `windowSeconds` old. Callers plug
// this into an UPDATE...CASE so a single atomic statement both resets an
// expired window and increments a live one, without a separate read-then-write
// that concurrent hits on the same row could race.
export function windowExpiredCondition(
  windowStartColumn: AnyPgColumn,
  windowSeconds: number,
): SQL {
  return sql`(now() - ${windowStartColumn}) >= (${windowSeconds} * interval '1 second')`;
}

export function secondsRemainingInWindow(
  windowStart: Date,
  windowSeconds: number,
): number {
  const elapsedSeconds = (Date.now() - windowStart.getTime()) / 1000;
  const remainingSeconds = windowSeconds - elapsedSeconds;
  return Math.max(1, Math.ceil(remainingSeconds));
}

// Decides allow/deny from the counter row read back by the caller's atomic
// update. A `null` counter (the row vanished between resolution and this
// check — a deleted source or user) is allowed: there is nothing left to
// throttle, and the caller's own not-found handling takes over.
export function evaluateThrottleCounter(
  counter: FixedWindowCounter | null,
  maxHits: number,
  windowSeconds: number,
): ThrottleResult {
  if (!counter) {
    return { allowed: true };
  }

  if (counter.count > maxHits) {
    return {
      allowed: false,
      retryAfterSeconds: secondsRemainingInWindow(
        counter.windowStart,
        windowSeconds,
      ),
    };
  }

  return { allowed: true };
}
