import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";

export async function findUserStripeCustomerId(
  userId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.userId, userId))
    .limit(1);

  return row?.stripeCustomerId ?? null;
}

// Persist the Stripe customer id on the users row (see cancelBillingForUser for
// why deletion needs it). The user is registered before checkout, so a missing
// row should never happen; if it does, throw rather than swallow the write. For
// a schedule-only checkout this row is the sole record of the customer, so a
// lost write silently reopens the deletion gap — failing loud makes the webhook
// 500 and Stripe redeliver once any provisioning race has resolved.
export async function setUserStripeCustomerId(
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(users)
    .set({ stripeCustomerId })
    .where(eq(users.userId, userId))
    .returning({ userId: users.userId });

  if (updated.length === 0) {
    console.error("[users] no users row to persist Stripe customer id", {
      userId,
    });
    throw new Error(
      `No users row for ${userId}; cannot persist Stripe customer id`,
    );
  }
}
