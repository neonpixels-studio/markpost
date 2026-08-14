import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { cancelSubscriptionsForCustomer } from "./stripe";
import { findSubscriptionByUserId } from "../utils/billing";
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

// Cancel Stripe billing for the account (see cancelSubscriptionsForCustomer for
// why by-customer, not by-stored-id). Runs before the DB delete so the customer
// id is still on the row — it cascades away with it. A sweep failure fails the
// whole delete closed (503) so we never remove the account while billing may
// still be live; the user is told to retry. Returns whether a sweep actually
// ran, so the caller can flag the (irreversible) canceled-billing but
// account-not-deleted state if a later delete step fails.
async function cancelBillingForUser(userId: string): Promise<boolean> {
  const subscription = await findSubscriptionByUserId(userId);
  // No subscription row means checkout never linked a Stripe customer; a free
  // user delete, nothing to sweep. Warn (not error) so it doesn't cry wolf.
  if (!subscription) {
    console.warn("[account] no subscription row; skipping Stripe sweep", {
      userId,
    });
    return false;
  }

  const { stripeCustomerId, stripeSubscriptionId } = subscription;

  // A row missing its customer id should not happen (upsertSubscription always
  // sets it). If it also carries a subscription id the row is corrupt and we
  // can't sweep by customer — and the by-id cancel path is gone — so we can't
  // confirm billing is dead. Fail closed rather than delete over possibly-live
  // billing.
  if (!stripeCustomerId && stripeSubscriptionId) {
    console.error(
      "[account] subscription row missing Stripe customer id; failing closed",
      { userId },
    );
    throw billingUnavailableError();
  }

  // No customer id and no subscription id: nothing billable to sweep. Log at
  // error so the broken row is visible rather than swallowed.
  if (!stripeCustomerId) {
    console.error(
      "[account] subscription row missing Stripe customer id; nothing to sweep",
      { userId },
    );
    return false;
  }

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
