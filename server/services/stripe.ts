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

// Generic message surfaced when the sweep fails. Stripe errors carry a numeric
// statusCode, which apiErrorHandler treats as client-facing and would leak
// verbatim (see utils/errors.ts); this keeps the raw Stripe text off the wire.
const STRIPE_SWEEP_FAILED_MESSAGE = "Stripe subscription sweep failed";

// The narrow slice of the Stripe subscriptions API the sweep depends on, so the
// cancellation logic can be unit-tested with a fake in place of a live client.
export type SubscriptionGateway = {
  list: (
    params: Stripe.SubscriptionListParams,
  ) => Promise<Stripe.ApiList<Stripe.Subscription>>;
  cancel: (subscriptionId: string) => Promise<Stripe.Subscription>;
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
    list: (params) => stripe.subscriptions.list(params),
    cancel: (subscriptionId) => stripe.subscriptions.cancel(subscriptionId),
  };
}

function isTerminalStatus(status: Stripe.Subscription.Status): boolean {
  return TERMINAL_SUBSCRIPTION_STATUSES.has(status);
}

// A cancel can race a concurrent cancellation (webhook, portal). Stripe reports
// an already-gone or already-canceled subscription as resource_missing or an
// invalid_request naming the canceled status; both mean the goal is met.
function isAlreadyCanceledError(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeError)) {
    return false;
  }

  if (error.code === "resource_missing") {
    return true;
  }

  // rawType comes from the API payload (survives a minifying bundle); type is
  // the class name, which does not.
  const message = error.message ?? "";
  return (
    error.rawType === "invalid_request_error" &&
    ALREADY_CANCELED_MESSAGE.test(message)
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

async function cancelIfBillable(
  gateway: SubscriptionGateway,
  subscription: Stripe.Subscription,
): Promise<number> {
  if (isTerminalStatus(subscription.status)) {
    return 0;
  }

  const canceled = await cancelSubscription(gateway, subscription.id);
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
// non-terminal one, paginating until exhausted. Isolated from the live client
// (takes a SubscriptionGateway) so it can be unit-tested without Stripe.
export async function sweepCustomerSubscriptions(
  gateway: SubscriptionGateway,
  customerId: string,
): Promise<CustomerCancelResult> {
  let canceledCount = 0;
  const failedSubscriptionIds: string[] = [];
  let startingAfter: string | null = null;

  try {
    do {
      const page = await gateway.list({
        customer: customerId,
        status: "all",
        limit: SUBSCRIPTION_SWEEP_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      const outcome = await cancelPage(gateway, page.data);
      canceledCount += outcome.canceledCount;
      failedSubscriptionIds.push(...outcome.failedSubscriptionIds);
      startingAfter = nextCursor(page);
    } while (startingAfter);
  } catch (error) {
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
