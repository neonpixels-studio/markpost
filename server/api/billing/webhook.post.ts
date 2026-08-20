import type Stripe from "stripe";
import { apiErrorHandler, ApiError } from "../../utils/errors";
import {
  upsertSubscription,
  updateSubscriptionByStripeCustomerId,
  resolvePlanFromPriceId,
  resolveStatusFromStripe,
} from "../../utils/billing";
import {
  constructStripeEvent,
  extractSubscriptionData,
} from "../../services/stripe";
import { setUserStripeCustomerId } from "../../utils/users";

const STRIPE_WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET";
const STRIPE_SIGNATURE_HEADER = "stripe-signature";

const HANDLED_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "checkout.session.completed",
]);

function getWebhookSecret(): string {
  const secret = process.env[STRIPE_WEBHOOK_SECRET_ENV];
  if (!secret) {
    throw new ApiError(
      [
        {
          status: "503",
          title: "Service Unavailable",
          detail: "Webhook secret is not configured.",
        },
      ],
      503,
    );
  }

  return secret;
}

async function handleSubscriptionUpsert(
  subscription: Stripe.Subscription,
): Promise<void> {
  const data = extractSubscriptionData(subscription);

  if (!data.userId) {
    console.warn(
      "[billing/webhook] subscription missing userId metadata; skipping upsert",
      { stripeSubscriptionId: data.stripeSubscriptionId },
    );
    return;
  }

  const plan = resolvePlanFromPriceId(data.priceId);
  const status = resolveStatusFromStripe(data.status);
  const trialEndsAt = data.trialEnd ? new Date(data.trialEnd * 1000) : null;

  await upsertSubscription({
    userId: data.userId,
    plan,
    status,
    trialEndsAt,
    stripeCustomerId: data.stripeCustomerId,
    stripeSubscriptionId: data.stripeSubscriptionId,
  });
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  const data = extractSubscriptionData(subscription);

  // Guard on stripeSubscriptionId so a delayed deletion event for an old
  // subscription does not cancel a newer active one for the same customer.
  await updateSubscriptionByStripeCustomerId(data.stripeCustomerId, {
    plan: "hobby",
    status: "canceled",
    stripeSubscriptionId: data.stripeSubscriptionId,
    onlyIfSubscriptionId: data.stripeSubscriptionId,
  });
}

function extractSessionCustomerId(
  session: Stripe.Checkout.Session,
): string | null {
  const customer = session.customer;
  if (!customer) {
    return null;
  }

  return typeof customer === "string" ? customer : customer.id;
}

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  // subscription.created (delivered right after this) still creates the
  // subscriptions row. This handler only persists the Stripe customer id onto
  // the users row — the earliest event carrying it for a brand-new customer, and
  // the sole record for a schedule-only checkout (see cancelBillingForUser).
  if (session.mode !== "subscription") {
    return;
  }

  const userId = session.client_reference_id ?? session.metadata?.userId;
  if (!userId) {
    // createCheckoutSession always sets both client_reference_id and
    // metadata.userId, so neither being present means the checkout-creation code
    // regressed — log at error, not warn, so it surfaces.
    console.error(
      "[billing/webhook] checkout session missing userId; skipping customer id persist",
      { sessionId: session.id },
    );
    return;
  }

  const stripeCustomerId = extractSessionCustomerId(session);
  if (!stripeCustomerId) {
    console.warn(
      "[billing/webhook] checkout session has no customer; skipping customer id persist",
      { sessionId: session.id, userId },
    );
    return;
  }

  await setUserStripeCustomerId(userId, stripeCustomerId);
}

async function dispatchStripeEvent(stripeEvent: Stripe.Event): Promise<void> {
  if (!HANDLED_EVENTS.has(stripeEvent.type)) {
    return;
  }

  if (
    stripeEvent.type === "customer.subscription.created" ||
    stripeEvent.type === "customer.subscription.updated"
  ) {
    await handleSubscriptionUpsert(
      stripeEvent.data.object as Stripe.Subscription,
    );
    return;
  }

  if (stripeEvent.type === "customer.subscription.deleted") {
    await handleSubscriptionDeleted(
      stripeEvent.data.object as Stripe.Subscription,
    );
    return;
  }

  if (stripeEvent.type === "checkout.session.completed") {
    await handleCheckoutSessionCompleted(
      stripeEvent.data.object as Stripe.Checkout.Session,
    );
  }
}

export default defineEventHandler(async (event) => {
  try {
    const rawBodyText = await readRawBody(event);
    const rawBody = rawBodyText ?? "";

    const signatureHeader = getHeader(event, STRIPE_SIGNATURE_HEADER);
    if (!signatureHeader) {
      throw new ApiError(
        [
          {
            status: "401",
            title: "Unauthorized",
            detail: "Missing Stripe-Signature header.",
          },
        ],
        401,
      );
    }

    const webhookSecret = getWebhookSecret();

    let stripeEvent;
    try {
      stripeEvent = constructStripeEvent(
        rawBody,
        signatureHeader,
        webhookSecret,
      );
    } catch {
      throw new ApiError(
        [
          {
            status: "400",
            title: "Bad Request",
            detail: "Invalid Stripe webhook signature.",
          },
        ],
        400,
      );
    }

    await dispatchStripeEvent(stripeEvent);

    return { data: { received: true } };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
