import { requireScope, requireUser } from "../../utils/auth";
import { apiErrorHandler, ApiError } from "../../utils/errors";
import { findSubscriptionByUserId } from "../../utils/billing";
import { buildAppUrl } from "../../utils/appUrl";
import { createCheckoutSession } from "../../services/stripe";

const STRIPE_PRO_PRICE_ID_ENV = "STRIPE_PRO_PRICE_ID";
const STRIPE_PRO_ANNUAL_PRICE_ID_ENV = "STRIPE_PRO_ANNUAL_PRICE_ID";

const VALID_PRICE_ID_KEYS = ["pro", "pro_annual"] as const;
type PriceIdKey = (typeof VALID_PRICE_ID_KEYS)[number];

function resolveAnnualPriceId(): string {
  const annualId = process.env[STRIPE_PRO_ANNUAL_PRICE_ID_ENV];
  if (!annualId) {
    throw new ApiError(
      [
        {
          status: "503",
          title: "Service Unavailable",
          detail: "Annual billing is not configured on this server.",
        },
      ],
      503,
    );
  }

  return annualId;
}

function resolveMonthlyPriceId(): string {
  const proId = process.env[STRIPE_PRO_PRICE_ID_ENV];
  if (!proId) {
    throw new ApiError(
      [
        {
          status: "503",
          title: "Service Unavailable",
          detail: "Billing is not configured on this server.",
        },
      ],
      503,
    );
  }

  return proId;
}

function resolveStripePriceId(priceKey: PriceIdKey): string {
  if (priceKey === "pro_annual") {
    return resolveAnnualPriceId();
  }

  return resolveMonthlyPriceId();
}

function isValidPriceKey(value: unknown): value is PriceIdKey {
  return (
    typeof value === "string" &&
    (VALID_PRICE_ID_KEYS as readonly string[]).includes(value)
  );
}

export default defineEventHandler(async (event) => {
  try {
    const userId = requireUser(event);
    requireScope(event, "billing:write");
    const body = await readBody(event);

    const priceKey = body?.priceKey;
    if (!isValidPriceKey(priceKey)) {
      throw new ApiError(
        [
          {
            status: "422",
            title: "Unprocessable Entity",
            detail: `priceKey must be one of: ${VALID_PRICE_ID_KEYS.join(", ")}`,
          },
        ],
        422,
      );
    }

    const priceId = resolveStripePriceId(priceKey);
    const existingSubscription = await findSubscriptionByUserId(userId);
    const appUrl = buildAppUrl();

    const session = await createCheckoutSession({
      customerId: existingSubscription?.stripeCustomerId ?? null,
      customerEmail: null,
      priceId,
      successUrl: `${appUrl}/settings?billing=success`,
      cancelUrl: `${appUrl}/pricing`,
      userId,
      isReturningCustomer: Boolean(existingSubscription),
    });

    return { data: { url: session.url } };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
