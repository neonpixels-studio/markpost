import { and, eq, isNotNull, not } from "drizzle-orm";
import { getDb } from "../db";
import {
  subscriptions,
  SUBSCRIPTION_PLANS,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "../db/schema";

export type SubscriptionRow = {
  id: string;
  userId: string;
  plan: string;
  status: string;
  trialEndsAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertSubscriptionInput = {
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
};

export async function findSubscriptionByUserId(
  userId: string,
): Promise<SubscriptionRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  return row ?? null;
}

export async function findSubscriptionByStripeCustomerId(
  stripeCustomerId: string,
): Promise<SubscriptionRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
    .limit(1);

  return row ?? null;
}

// Stripe does not guarantee event ordering, so a stale
// `customer.subscription.updated` can arrive after the `deleted` event that
// canceled the row. A Stripe subscription that has reached `canceled` is
// terminal and never transitions back, so any upsert that would revive the
// same canceled subscription is out-of-order and must be ignored. Mirrors the
// `onlyIfSubscriptionId` guard on updateSubscriptionByStripeCustomerId: the
// update only applies when the existing row is not a canceled copy of this
// same subscription. A resubscribe (new stripeSubscriptionId) still applies.
function buildRevivalGuard(stripeSubscriptionId: string) {
  // isNotNull keeps the match NULL-safe: without it a canceled row whose
  // stripeSubscriptionId is NULL makes the equality (and thus the whole guard)
  // evaluate to SQL UNKNOWN, which Postgres treats as false in a WHERE clause
  // and would silently block every future upsert for that customer.
  const revivesCanceledSubscription = and(
    eq(subscriptions.status, "canceled"),
    isNotNull(subscriptions.stripeSubscriptionId),
    eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId),
  );

  return not(revivesCanceledSubscription!);
}

export async function upsertSubscription(
  input: UpsertSubscriptionInput,
): Promise<void> {
  const db = getDb();
  await db
    .insert(subscriptions)
    .values({
      userId: input.userId,
      plan: input.plan,
      status: input.status,
      trialEndsAt: input.trialEndsAt,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        plan: input.plan,
        status: input.status,
        trialEndsAt: input.trialEndsAt,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        updatedAt: new Date(),
      },
      setWhere: buildRevivalGuard(input.stripeSubscriptionId),
    });
}

export async function updateSubscriptionByStripeCustomerId(
  stripeCustomerId: string,
  updates: {
    plan?: SubscriptionPlan;
    status: SubscriptionStatus;
    trialEndsAt?: Date | null;
    stripeSubscriptionId?: string;
    onlyIfSubscriptionId?: string;
  },
): Promise<void> {
  const db = getDb();

  const { onlyIfSubscriptionId, ...updateFields } = updates;

  const whereClause = onlyIfSubscriptionId
    ? and(
        eq(subscriptions.stripeCustomerId, stripeCustomerId),
        eq(subscriptions.stripeSubscriptionId, onlyIfSubscriptionId),
      )
    : eq(subscriptions.stripeCustomerId, stripeCustomerId);

  const updated = await db
    .update(subscriptions)
    .set({
      ...updateFields,
      updatedAt: new Date(),
    })
    .where(whereClause)
    .returning({ id: subscriptions.id });

  if (updated.length === 0) {
    console.warn(
      "[billing] updateSubscriptionByStripeCustomerId: no row found for customer",
      { stripeCustomerId, onlyIfSubscriptionId },
    );
  }
}

function buildProPriceIdSet(): Set<string> {
  const monthlyId = process.env.STRIPE_PRO_PRICE_ID ?? "";
  const annualId = process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? "";
  const ids = new Set<string>();

  if (monthlyId) {
    ids.add(monthlyId);
  }

  if (annualId) {
    ids.add(annualId);
  }

  return ids;
}

export function resolvePlanFromPriceId(
  priceId: string | null,
): SubscriptionPlan {
  if (!priceId) {
    return "hobby";
  }

  const proPriceIds = buildProPriceIdSet();

  if (proPriceIds.has(priceId)) {
    return "pro";
  }

  return "hobby";
}

export function resolveStatusFromStripe(
  stripeStatus: string,
): SubscriptionStatus {
  const validStatuses: Set<SubscriptionStatus> = new Set([
    "active",
    "trialing",
    "past_due",
    "canceled",
    "incomplete",
  ]);

  if (validStatuses.has(stripeStatus as SubscriptionStatus)) {
    return stripeStatus as SubscriptionStatus;
  }

  return "incomplete";
}

export function isValidPlan(value: string): value is SubscriptionPlan {
  return (SUBSCRIPTION_PLANS as readonly string[]).includes(value);
}

// Matches the trial_period_days passed to Stripe when creating a checkout
// session for a new customer (see services/stripe.ts#createCheckoutSession).
export const TRIAL_PERIOD_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type TrialProgress = {
  daysLeft: number;
  percentElapsed: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// `daysLeft` is exact (derived from the real trialEndsAt), but `percentElapsed`
// back-computes the trial start by assuming every trial is TRIAL_PERIOD_DAYS
// long. The subscriptions table doesn't persist the actual trial start date,
// so if a trial is ever extended (a Stripe coupon, manual override, etc.) the
// progress bar will be inaccurate even though the days-left label stays
// correct. Fixing this properly requires storing Stripe's trial_start on the
// subscription row — out of scope here since every trial created today goes
// through createCheckoutSession with a fixed TRIAL_PERIOD_DAYS length.
export function calculateTrialProgress(
  trialEndsAt: Date,
  now: Date = new Date(),
): TrialProgress {
  const totalTrialMs = TRIAL_PERIOD_DAYS * MS_PER_DAY;
  const msRemaining = trialEndsAt.getTime() - now.getTime();
  const msElapsed = totalTrialMs - msRemaining;

  return {
    daysLeft: Math.max(0, Math.ceil(msRemaining / MS_PER_DAY)),
    percentElapsed: Math.round(clamp(msElapsed / totalTrialMs, 0, 1) * 100),
  };
}
