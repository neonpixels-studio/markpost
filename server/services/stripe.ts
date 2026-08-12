import Stripe from "stripe";
import { TRIAL_PERIOD_DAYS } from "../utils/billing";

const STRIPE_SECRET_KEY_ENV = "STRIPE_SECRET_KEY";

let cachedStripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (cachedStripeClient) {
    return cachedStripeClient;
  }

  const secretKey = process.env[STRIPE_SECRET_KEY_ENV];
  if (!secretKey) {
    throw new Error(`${STRIPE_SECRET_KEY_ENV} is not set`);
  }

  cachedStripeClient = new Stripe(secretKey);
  return cachedStripeClient;
}

export type CheckoutSessionOptions = {
  customerId: string | null;
  customerEmail: string | null;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  userId: string;
  isReturningCustomer: boolean;
};

export type CheckoutSessionResult = {
  url: string;
};

export async function createCheckoutSession(
  options: CheckoutSessionOptions,
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();

  const subscriptionData: Stripe.Checkout.SessionCreateParams["subscription_data"] =
    {
      metadata: { userId: options.userId },
    };

  if (!options.isReturningCustomer) {
    subscriptionData.trial_period_days = TRIAL_PERIOD_DAYS;
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: options.priceId, quantity: 1 }],
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    client_reference_id: options.userId,
    subscription_data: subscriptionData,
    metadata: { userId: options.userId },
  };

  if (options.customerId) {
    sessionParams.customer = options.customerId;
  } else if (options.customerEmail) {
    sessionParams.customer_email = options.customerEmail;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  if (!session.url) {
    throw new Error("Stripe checkout session created without a URL");
  }

  return { url: session.url };
}

export type CustomerPortalOptions = {
  customerId: string;
  returnUrl: string;
};

export type CustomerPortalResult = {
  url: string;
};

export async function createCustomerPortalSession(
  options: CustomerPortalOptions,
): Promise<CustomerPortalResult> {
  const stripe = getStripeClient();

  const session = await stripe.billingPortal.sessions.create({
    customer: options.customerId,
    return_url: options.returnUrl,
  });

  return { url: session.url };
}

export function constructStripeEvent(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): Stripe.Event {
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(
    rawBody,
    signatureHeader,
    webhookSecret,
  );
}

// Stripe subscription statuses that can't transition further and reject a
// cancel call (see Subscription.Status). Everything else is still billable and
// must be swept on account deletion.
const TERMINAL_SUBSCRIPTION_STATUSES: ReadonlySet<Stripe.Subscription.Status> =
  new Set(["canceled", "incomplete_expired"]);

// Page size for the customer subscription sweep. Stripe caps list at 100.
const SUBSCRIPTION_SWEEP_PAGE_SIZE = 100;

// Stripe's wording when a subscription reached the canceled state between the
// list and the cancel call. Anchored on "status ...canceled" so it doesn't
// also swallow invalid_request errors that mean the cancel was *refused*
// (e.g. "managed by a schedule and cannot be canceled").
const ALREADY_CANCELED_MESSAGE = /status ['"]?canceled/i;

// Stripe's wording when a direct cancel is refused because a subscription
// schedule manages the subscription. The sweep releases the schedule and
// retries only on this error, so a genuinely-active schedule (irreversible to
// release) is never touched unless Stripe proves the cancel needs it.
const SCHEDULE_MANAGED_CANCEL_MESSAGE =
  /managed by a (subscription )?schedule/i;

// Generic message surfaced when the sweep fails. Stripe errors carry a numeric
// statusCode, which apiErrorHandler treats as client-facing and would leak
// verbatim (see utils/errors.ts); this keeps the raw Stripe text off the wire.
const STRIPE_SWEEP_FAILED_MESSAGE = "Stripe subscription sweep failed";

// Stripe never deletes customer or subscription objects, so a clean sweep can
// mean the key genuinely has no live billing OR that this key can't see the
// customer at all (wrong test/live mode, or a rotated key from another account).
// A resource_missing on retrieving the customer means the account is invisible
// to this key and may still be billing under the right one — fail loud rather
// than let a still-billing account be deleted.
const KEY_CANNOT_SEE_CUSTOMER_MESSAGE =
  "Stripe key cannot see customer; refusing to treat billing as canceled";

// The narrow slice of the Stripe API the sweep depends on, so the cancellation
// logic can be unit-tested with a fake in place of a live client. retrieveCustomer
// proves the key/mode can actually see the account before a clean sweep is
// trusted (see assertKeyCanSeeCustomer).
export type SubscriptionGateway = {
  retrieveCustomer: (
    customerId: string,
  ) => Promise<Stripe.Customer | Stripe.DeletedCustomer>;
  list: (
    params: Stripe.SubscriptionListParams,
  ) => Promise<Stripe.ApiList<Stripe.Subscription>>;
  cancel: (subscriptionId: string) => Promise<Stripe.Subscription>;
  // Detaches a subscription from its managing subscription_schedule. A
  // schedule-managed subscription rejects a direct cancel, so the sweep
  // releases the schedule and retries the cancel (see releaseManagingSchedule).
  releaseSchedule: (scheduleId: string) => Promise<Stripe.SubscriptionSchedule>;
};

export type CustomerCancelResult = {
  canceledCount: number;
  // Ids the sweep tried but could not cancel (e.g. schedule-managed, transient
  // Stripe error). Non-empty means billing may still be live; the caller fails
  // loud rather than deleting the account on top of it.
  failedSubscriptionIds: string[];
};

type CancelAttempt = {
  canceledCount: number;
  failedSubscriptionIds: string[];
};

function toSubscriptionGateway(stripe: Stripe): SubscriptionGateway {
  return {
    retrieveCustomer: (customerId) => stripe.customers.retrieve(customerId),
    list: (params) => stripe.subscriptions.list(params),
    cancel: (subscriptionId) => stripe.subscriptions.cancel(subscriptionId),
    releaseSchedule: (scheduleId) =>
      stripe.subscriptionSchedules.release(scheduleId),
  };
}

// A subscription's `schedule` is the managing schedule id (or the expanded
// object once populated), or null when nothing manages it.
function getManagingScheduleId(
  subscription: Stripe.Subscription,
): string | null {
  const schedule = subscription.schedule;
  if (!schedule) {
    return null;
  }

  return typeof schedule === "string" ? schedule : schedule.id;
}

// Detaches a subscription from its managing schedule so the retry cancel
// succeeds. Only reached after Stripe refused the direct cancel for this
// reason, so the schedule is known to be blocking; releasing is irreversible,
// which is why the sweep never does it speculatively.
async function releaseManagingSchedule(
  gateway: SubscriptionGateway,
  subscriptionId: string,
  scheduleId: string,
): Promise<void> {
  await gateway.releaseSchedule(scheduleId);
  console.info("[stripe] released subscription schedule to unblock cancel", {
    subscriptionId,
    scheduleId,
  });
}

function isTerminalStatus(status: Stripe.Subscription.Status): boolean {
  return TERMINAL_SUBSCRIPTION_STATUSES.has(status);
}

function isResourceMissingError(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeError &&
    error.code === "resource_missing"
  );
}

// A cancel can race a concurrent cancellation (webhook, portal). Stripe reports
// an already-gone or already-canceled subscription as resource_missing or an
// invalid_request naming the canceled status; both mean the goal is met. This
// is only reached for a subscription already returned by list under this key,
// so the key/mode is proven — resource_missing here is a genuine race, not the
// wrong-key blind spot assertKeyCanSeeCustomer guards against.
function isAlreadyCanceledError(error: unknown): boolean {
  if (isResourceMissingError(error)) {
    return true;
  }

  if (!(error instanceof Stripe.errors.StripeError)) {
    return false;
  }

  // rawType comes from the API payload (survives a minifying bundle); type is
  // the class name, which does not.
  const message = error.message ?? "";
  return (
    error.rawType === "invalid_request_error" &&
    ALREADY_CANCELED_MESSAGE.test(message)
  );
}

// A customer this key can't see means billing may still be live under the
// correct key — never delete the account on top of it. Logs distinctly (so the
// misconfiguration is greppable) and throws a descriptive error; the live
// boundary (cancelSubscriptionsForCustomer) sanitizes it before the wire.
function failKeyCannotSeeCustomer(customerId: string, cause: unknown): never {
  // Carry the raw Stripe error (e.g. "No such customer: 'cus_x'") so triage can
  // tell a wrong key from a bad cursor without re-deriving it.
  console.error(
    "[stripe] key cannot see customer; refusing to treat billing as canceled",
    { customerId, error: cause },
  );
  throw new Error(KEY_CANNOT_SEE_CUSTOMER_MESSAGE, { cause });
}

// Prove the key/mode can actually see this customer before trusting an empty
// sweep. A wrong test/live or rotated key can't see a customer it doesn't own,
// which an empty sweep would otherwise read as "no billing" and let the account
// be deleted while it still bills under the correct key. A retrieve succeeding
// (even a deleted-customer object) proves visibility; a resource_missing means
// the key can't see the account — fail loud. Any other retrieve error
// (network/5xx) still aborts the delete, logged with the customer id.
async function assertKeyCanSeeCustomer(
  gateway: SubscriptionGateway,
  customerId: string,
): Promise<void> {
  try {
    await gateway.retrieveCustomer(customerId);
  } catch (error) {
    if (isResourceMissingError(error)) {
      failKeyCannotSeeCustomer(customerId, error);
    }
    console.error("[stripe] customer visibility check failed", {
      customerId,
      error,
    });
    throw error;
  }
}

// A direct cancel Stripe refused because a schedule manages the subscription.
// This — not any invalid_request — is the only cancel failure the sweep answers
// by releasing the schedule and retrying.
function isScheduleManagedCancelError(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeError)) {
    return false;
  }

  return (
    error.rawType === "invalid_request_error" &&
    SCHEDULE_MANAGED_CANCEL_MESSAGE.test(error.message ?? "")
  );
}

// Returns true when this call canceled the subscription, false when it was
// already terminal (raced by a webhook/portal cancellation) — so the caller's
// count reflects only subscriptions this sweep actually canceled.
async function cancelSubscription(
  gateway: SubscriptionGateway,
  subscriptionId: string,
): Promise<boolean> {
  try {
    await gateway.cancel(subscriptionId);
    return true;
  } catch (error) {
    if (isAlreadyCanceledError(error)) {
      console.warn("[stripe] cancel skipped; subscription already terminal", {
        subscriptionId,
      });
      return false;
    }
    throw error;
  }
}

// Cancel the subscription, falling back to releasing its managing schedule only
// when Stripe refuses the direct cancel for that reason. Cancel-first keeps the
// irreversible release off the happy path and, critically, off any subscription
// whose cancel fails for an unrelated reason (transient 5xx, rate limit) — those
// fail loud with the schedule intact rather than destroyed.
async function cancelWithScheduleReleaseFallback(
  gateway: SubscriptionGateway,
  subscription: Stripe.Subscription,
): Promise<boolean> {
  try {
    return await cancelSubscription(gateway, subscription.id);
  } catch (error) {
    if (!isScheduleManagedCancelError(error)) {
      throw error;
    }

    const scheduleId = getManagingScheduleId(subscription);
    if (!scheduleId) {
      // Stripe refused the cancel as schedule-managed yet the subscription
      // carries no schedule id to release; retrying would just repeat the
      // failure, so surface the original error loudly.
      console.error(
        "[stripe] cancel refused as schedule-managed but no schedule id present",
        { subscriptionId: subscription.id },
      );
      throw error;
    }

    await releaseManagingSchedule(gateway, subscription.id, scheduleId);
  }

  return cancelAfterScheduleRelease(gateway, subscription.id);
}

// The retry cancel after an irreversible schedule release. If it fails (a
// transient 5xx/rate-limit landing in the gap), the schedule is already gone
// and the subscription is still billable — a state that cannot be undone — so
// log it distinctly before failing loud. An already-terminal race returns false
// without throwing and is not this failure.
async function cancelAfterScheduleRelease(
  gateway: SubscriptionGateway,
  subscriptionId: string,
): Promise<boolean> {
  try {
    return await cancelSubscription(gateway, subscriptionId);
  } catch (error) {
    console.error(
      "[stripe] subscription still active after releasing its schedule; the schedule cannot be restored",
      { subscriptionId },
    );
    throw error;
  }
}

async function cancelIfBillable(
  gateway: SubscriptionGateway,
  subscription: Stripe.Subscription,
): Promise<number> {
  if (isTerminalStatus(subscription.status)) {
    return 0;
  }

  const canceled = await cancelWithScheduleReleaseFallback(
    gateway,
    subscription,
  );
  return canceled ? 1 : 0;
}

// One cancel failing must not abandon the rest of the sweep (that would leave
// the exact orphaned billing this exists to stop). Record the failure and keep
// going; the caller surfaces it after the whole customer is swept.
async function attemptCancel(
  gateway: SubscriptionGateway,
  subscription: Stripe.Subscription,
): Promise<CancelAttempt> {
  try {
    const canceledCount = await cancelIfBillable(gateway, subscription);
    return { canceledCount, failedSubscriptionIds: [] };
  } catch (error) {
    console.error("[stripe] cancel failed; continuing sweep", {
      subscriptionId: subscription.id,
      error,
    });
    return { canceledCount: 0, failedSubscriptionIds: [subscription.id] };
  }
}

async function cancelPage(
  gateway: SubscriptionGateway,
  page: Stripe.Subscription[],
): Promise<CustomerCancelResult> {
  let canceledCount = 0;
  const failedSubscriptionIds: string[] = [];

  for (const subscription of page) {
    const attempt = await attemptCancel(gateway, subscription);
    canceledCount += attempt.canceledCount;
    failedSubscriptionIds.push(...attempt.failedSubscriptionIds);
  }

  return { canceledCount, failedSubscriptionIds };
}

function nextCursor(page: Stripe.ApiList<Stripe.Subscription>): string | null {
  if (!page.has_more) {
    return null;
  }

  const lastId = page.data[page.data.length - 1]?.id;
  // has_more with an empty page would silently cap the sweep; fail loud instead
  // of returning a partial success.
  if (!lastId) {
    throw new Error("Stripe reported has_more with an empty subscription page");
  }

  return lastId;
}

// Sweep every subscription Stripe holds for the customer and cancel each
// non-terminal one, paginating until exhausted. If the sweep finds nothing, it
// proves the key can see the customer (assertKeyCanSeeCustomer) so a wrong-key
// empty result never reads as "no billing". Isolated from the live client
// (takes a SubscriptionGateway) so it can be unit-tested without Stripe.
export async function sweepCustomerSubscriptions(
  gateway: SubscriptionGateway,
  customerId: string,
): Promise<CustomerCancelResult> {
  let canceledCount = 0;
  const failedSubscriptionIds: string[] = [];
  let startingAfter: string | null = null;
  let sawAnySubscription = false;

  try {
    do {
      const page = await gateway.list({
        customer: customerId,
        status: "all",
        limit: SUBSCRIPTION_SWEEP_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      sawAnySubscription = sawAnySubscription || page.data.length > 0;
      const outcome = await cancelPage(gateway, page.data);
      canceledCount += outcome.canceledCount;
      failedSubscriptionIds.push(...outcome.failedSubscriptionIds);
      startingAfter = nextCursor(page);
    } while (startingAfter);
  } catch (error) {
    // Stripe validates the customer filter on list, so a key that can't see the
    // customer may surface here as resource_missing rather than an empty page —
    // the wrong-key blind spot. Only diagnose it that way when nothing was seen:
    // a resource_missing after earlier pages canceled (customer deleted mid-sweep,
    // an unresolvable cursor) is a genuine race, not a bad key. Classify before
    // the partial-progress log so the wrong-key case doesn't emit a misleading
    // "partial progress" line for a sweep that canceled nothing. (Safe because
    // nextCursor derives the cursor from the last row, so an empty first page
    // can't be followed by a page-2 resource_missing.)
    if (!sawAnySubscription && isResourceMissingError(error)) {
      failKeyCannotSeeCustomer(customerId, error);
    }

    // Surface what was already canceled before the pagination/list failure
    // rather than losing it with the stack.
    console.error("[stripe] sweep aborted mid-pagination; partial progress", {
      customerId,
      canceledCount,
      failedSubscriptionIds,
      error,
    });
    throw error;
  }

  // Any subscription returned proves the key can see the customer. Only an empty
  // sweep is ambiguous — a wrong test/live or rotated key that returns no rows
  // (rather than erroring) for a customer it can't see must not read as "no
  // billing". Prove visibility before trusting it; a key that can see even one
  // subscription needs no extra round trip and isn't blocked by a transient
  // retrieve failure.
  if (!sawAnySubscription) {
    await assertKeyCanSeeCustomer(gateway, customerId);
  }

  return { canceledCount, failedSubscriptionIds };
}

// Cancel every billable subscription for a Stripe customer, not just a stored
// subscription id: a subscription created outside checkout, or a stale local
// row after a missed webhook, would otherwise keep billing. Idempotent and
// tolerant of already-canceled/terminal subscriptions.
export async function cancelSubscriptionsForCustomer(
  customerId: string,
): Promise<CustomerCancelResult> {
  const gateway = toSubscriptionGateway(getStripeClient());

  let result: CustomerCancelResult;
  try {
    result = await sweepCustomerSubscriptions(gateway, customerId);
  } catch (error) {
    console.error("[stripe] subscription sweep failed", { customerId, error });
    throw new Error(STRIPE_SWEEP_FAILED_MESSAGE);
  }

  if (result.failedSubscriptionIds.length > 0) {
    console.error("[stripe] subscription sweep incomplete", {
      customerId,
      canceledCount: result.canceledCount,
      failedSubscriptionIds: result.failedSubscriptionIds,
    });
    throw new Error(STRIPE_SWEEP_FAILED_MESSAGE);
  }

  return result;
}

export type SubscriptionEventData = {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  priceId: string | null;
  trialEnd: number | null;
  userId: string | null;
};

export function extractSubscriptionData(
  subscription: Stripe.Subscription,
): SubscriptionEventData {
  const firstItem = subscription.items.data[0];
  const priceId = firstItem?.price?.id ?? null;
  const userId =
    subscription.metadata?.userId ?? subscription.metadata?.user_id ?? null;

  return {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId:
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id,
    status: subscription.status,
    priceId,
    trialEnd: subscription.trial_end,
    userId,
  };
}
