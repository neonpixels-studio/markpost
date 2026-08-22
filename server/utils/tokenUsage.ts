import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { apiTokens } from "../db/schema";

// Every API-token-authenticated request would otherwise UPDATE the token row to
// refresh lastUsedAt, so a CLI polling or syncing in a loop generates one write
// and one serialized row lock per request against the same api_tokens row.
// lastUsedAt only needs to be "roughly when the token was last active", not
// exact, so gate the write to a coarse interval: skip it while the stored value
// is newer than LAST_USED_AT_THROTTLE_MS. This mirrors the bounded-cost
// tradeoff eventRetention.ts already makes for pruning — freshness within a few
// minutes in exchange for dropping the per-request write amplification.
export const LAST_USED_AT_THROTTLE_MS = 5 * 60 * 1000;

export function isLastUsedAtStale(
  lastUsedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastUsedAt) {
    return true;
  }

  return now.getTime() - lastUsedAt.getTime() >= LAST_USED_AT_THROTTLE_MS;
}

// Best-effort and never allowed to throw: refreshing lastUsedAt must never
// break the request that triggered it. Callers pass the lastUsedAt already read
// during token lookup so this adds no extra read to the hot path — only a
// conditional write when the stored value has gone stale.
export async function refreshTokenLastUsedAt(
  tokenId: string,
  lastUsedAt: Date | null | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (!isLastUsedAtStale(lastUsedAt, now)) {
    return;
  }

  try {
    await getDb()
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(eq(apiTokens.id, tokenId));
  } catch (error) {
    console.error("[auth] failed to update lastUsedAt", error);
  }
}
