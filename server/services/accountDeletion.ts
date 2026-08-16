import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { cancelSubscriptionsForCustomer } from "./stripe";
import {
  findSubscriptionByUserId,
  type SubscriptionRow,
} from "../utils/billing";
import { findUserStripeCustomerId } from "../utils/users";
import { deleteClerkUser } from "../utils/clerk";
import { ApiError } from "../utils/errors";

export type ReconcileAccountDeletionOptions = {
  // The in-app DELETE path still has a live Clerk identity to remove; the Clerk
  // `user.deleted` webhook fires *after* Clerk deleted it, so the webhook path
  // sets this false to avoid a redundant (404-ing) delete call.
  deleteClerkIdentity: boolean;
};

function billingUnavailableError(): ApiError {
  return new ApiError(
    [
      {
        status: "503",
        title: "Service Unavailable",
        detail:
          "Could not cancel your subscription, so your account was not deleted. Please try again.",
      },
    ],
    503,
  );
}

async function deleteAllUserData(userId: string): Promise<void> {
  // Deleting the users row cascades to every user-owned table (api_tokens,
  // sources, records, events, user_settings, subscriptions) via their
  // ON DELETE cascade FKs.
  await getDb().delete(users).where(eq(users.userId, userId));
}

// Run the Stripe sweep for a resolved customer id. A failure fails the whole
// delete closed (503) so we never remove the account while billing may still be
// live; the user is told to retry.
async function sweepStripeCustomer(
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  try {
    const { canceledCount, canceledScheduleCount } =
      await cancelSubscriptionsForCustomer(stripeCustomerId);
    console.info("[account] canceled Stripe subscriptions on account delete", {
      userId,
      canceledCount,
      canceledScheduleCount,
    });
  } catch (error) {
    console.error("[account] Stripe subscription sweep failed", {
      userId,
      error,
    });
    throw billingUnavailableError();
  }
}

// The users row and the subscriptions row should point at the same Stripe
// customer, but a missed or out-of-order webhook could leave them disagreeing.
// Sweeping only one would leave the other billing a deleted account, so cancel
// every distinct id. cancelSubscriptionsForCustomer is idempotent, so the common
// case (both equal, or only one present) costs at most one redundant no-op call.
function distinctCustomerIds(candidates: (string | null)[]): string[] {
  return [...new Set(candidates.filter((id): id is string => Boolean(id)))];
}

// Sweep each distinct customer id in turn. If a later id fails after an earlier
// one was already (irreversibly) canceled, log that partial state distinctly
// before failing closed: the account stays live but some billing is gone, so the
// retry the caller prompts must re-run against the still-billable ids (safe —
// cancelSubscriptionsForCustomer is idempotent).
async function sweepCustomers(
  userId: string,
  customerIds: string[],
): Promise<void> {
  const sweptCustomerIds: string[] = [];
  for (const customerId of customerIds) {
    await sweepAndTrackProgress(userId, customerId, sweptCustomerIds);
  }
}

async function sweepAndTrackProgress(
  userId: string,
  customerId: string,
  sweptCustomerIds: string[],
): Promise<void> {
  try {
    await sweepStripeCustomer(userId, customerId);
    sweptCustomerIds.push(customerId);
  } catch (error) {
    if (sweptCustomerIds.length > 0) {
      console.error(
        "[account] partial Stripe sweep; some billing canceled but account not deleted",
        { userId, sweptCustomerIds },
      );
    }
    throw error;
  }
}

// A subscription row carrying a subscription id but no customer id should not
// happen (upsertSubscription always sets it). The stray subscription can't be
// swept by customer — the by-id cancel path is gone — and may belong to a
// customer we don't have, so we can't confirm billing is dead. Fail closed
// rather than delete over possibly-live billing. This holds even when the users
// row has an id: sweeping that customer does not vouch for the orphaned one.
function isCorruptSubscriptionRow(
  subscription: SubscriptionRow | null,
): boolean {
  return Boolean(
    subscription?.stripeSubscriptionId && !subscription.stripeCustomerId,
  );
}

// No customer id from either source: nothing billable to sweep. Distinguish a
// free user (no subscription row) — warn, so it doesn't cry wolf — from a
// subscription row that exists but carries no ids at all, which is unexpected
// and logged at error so the broken row stays visible.
function logNothingToSweep(userId: string, hasSubscriptionRow: boolean): void {
  if (!hasSubscriptionRow) {
    console.warn("[account] no subscription row; skipping Stripe sweep", {
      userId,
    });
    return;
  }

  console.error(
    "[account] subscription row missing Stripe customer id; nothing to sweep",
    { userId },
  );
}

// Cancel Stripe billing for the account (see cancelSubscriptionsForCustomer for
// why by-customer, not by-stored-id). Runs before the DB delete so the customer
// id is still on the row — it cascades away with it. Returns whether a sweep
// actually ran, so the caller can flag the (irreversible) canceled-billing but
// account-not-deleted state if a later delete step fails.
//
// The customer id is resolved from users.stripe_customer_id as well as the
// subscriptions row. The users row is persisted at checkout completion
// (server/api/billing/webhook.post.ts) and survives independently of the
// subscriptions row, so it catches a customer whose checkout produced only a
// `not_started` schedule and no subscriptions row — a case the subscriptions
// lookup alone would miss, leaving the schedule to bill a deleted customer.
async function cancelBillingForUser(userId: string): Promise<boolean> {
  const persistedCustomerId = await findUserStripeCustomerId(userId);
  const subscription = await findSubscriptionByUserId(userId);

  if (isCorruptSubscriptionRow(subscription)) {
    console.error(
      "[account] subscription row missing Stripe customer id; failing closed",
      { userId },
    );
    throw billingUnavailableError();
  }

  const customerIds = distinctCustomerIds([
    persistedCustomerId,
    subscription?.stripeCustomerId ?? null,
  ]);

  if (customerIds.length === 0) {
    logNothingToSweep(userId, Boolean(subscription));
    return false;
  }

  await sweepCustomers(userId, customerIds);
  return true;
}

// Delete app data before the Clerk identity: the users-row delete is
// idempotent, so a retry after a Clerk failure safely no-ops the DB side. If a
// step fails after billing was swept, flag it: the user is still active but
// their subscriptions are already (irreversibly) canceled.
type DeleteAccountContext = {
  billingSwept: boolean;
  deleteClerkIdentity: boolean;
};

async function deleteAccount(
  userId: string,
  context: DeleteAccountContext,
): Promise<void> {
  try {
    await deleteAllUserData(userId);
    if (context.deleteClerkIdentity) {
      await deleteClerkUser(userId);
    }
  } catch (error) {
    if (context.billingSwept) {
      console.error(
        "[account] billing canceled but account delete failed; user still active",
        { userId },
      );
    }
    throw error;
  }
}

// Single source of truth for account teardown: cancel Stripe billing, then
// cascade-delete every user-owned row (and, for the in-app path, the Clerk
// identity). Shared by DELETE /api/account and the Clerk `user.deleted` webhook
// so an out-of-band Clerk deletion reconciles exactly like the in-app one.
export async function reconcileAccountDeletion(
  userId: string,
  options: ReconcileAccountDeletionOptions = { deleteClerkIdentity: true },
): Promise<void> {
  const billingSwept = await cancelBillingForUser(userId);
  await deleteAccount(userId, {
    billingSwept,
    deleteClerkIdentity: options.deleteClerkIdentity,
  });
}
