import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const mockUpsertSubscription = vi.fn();
const mockUpdateSubscriptionByStripeCustomerId = vi.fn();
const mockResolvePlanFromPriceId = vi.fn();
const mockResolveStatusFromStripe = vi.fn();

vi.mock("../../../../server/utils/billing", () => ({
  upsertSubscription: (...args: unknown[]) => mockUpsertSubscription(...args),
  updateSubscriptionByStripeCustomerId: (...args: unknown[]) =>
    mockUpdateSubscriptionByStripeCustomerId(...args),
  resolvePlanFromPriceId: (...args: unknown[]) =>
    mockResolvePlanFromPriceId(...args),
  resolveStatusFromStripe: (...args: unknown[]) =>
    mockResolveStatusFromStripe(...args),
}));

const mockConstructStripeEvent = vi.fn();
const mockExtractSubscriptionData = vi.fn();

vi.mock("../../../../server/services/stripe", () => ({
  constructStripeEvent: (...args: unknown[]) =>
    mockConstructStripeEvent(...args),
  extractSubscriptionData: (...args: unknown[]) =>
    mockExtractSubscriptionData(...args),
}));

const mockSetUserStripeCustomerId = vi.fn();

vi.mock("../../../../server/utils/users", () => ({
  setUserStripeCustomerId: (...args: unknown[]) =>
    mockSetUserStripeCustomerId(...args),
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockReadRawBody = vi.fn();
const mockGetHeader = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const handler = (await import("../../../../server/api/billing/webhook.post"))
  .default;

const WEBHOOK_SECRET = "whsec_test_secret";

function buildEvent(): H3Event {
  return { context: {} } as unknown as H3Event;
}

function makeSubscriptionObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_test123",
    customer: "cus_test123",
    status: "active",
    trial_end: null,
    items: { data: [{ price: { id: "price_pro_test" } }] },
    metadata: { userId: "user_abc123" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readRawBody", mockReadRawBody);
  vi.stubGlobal("getHeader", mockGetHeader);

  mockCreateError.mockClear();
  mockReadRawBody.mockClear();
  mockGetHeader.mockClear();

  mockUpsertSubscription.mockReset();
  mockUpdateSubscriptionByStripeCustomerId.mockReset();
  mockResolvePlanFromPriceId.mockReset();
  mockResolveStatusFromStripe.mockReset();
  mockConstructStripeEvent.mockReset();
  mockExtractSubscriptionData.mockReset();
  mockSetUserStripeCustomerId.mockReset();
  mockSetUserStripeCustomerId.mockResolvedValue(undefined);

  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

  mockResolvePlanFromPriceId.mockReturnValue("pro");
  mockResolveStatusFromStripe.mockReturnValue("active");
  mockUpsertSubscription.mockResolvedValue(undefined);
  mockUpdateSubscriptionByStripeCustomerId.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("POST /api/billing/webhook", () => {
  it("throws 401 when Stripe-Signature header is missing", async () => {
    mockReadRawBody.mockResolvedValue("{}");
    mockGetHeader.mockReturnValue(undefined);

    await expect(handler(buildEvent())).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it("throws 503 when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    mockReadRawBody.mockResolvedValue("{}");
    mockGetHeader.mockReturnValue("t=1234,v1=abc");

    await expect(handler(buildEvent())).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503 }),
    );
  });

  it("throws 400 when constructStripeEvent throws (invalid signature)", async () => {
    mockReadRawBody.mockResolvedValue("{}");
    mockGetHeader.mockReturnValue("t=1234,v1=bad_sig");
    mockConstructStripeEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    await expect(handler(buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it("returns { data: { received: true } } and upserts for subscription.created", async () => {
    const subscriptionObject = makeSubscriptionObject();
    const stripeEvent = {
      type: "customer.subscription.created",
      data: { object: subscriptionObject },
    };
    const subscriptionData = {
      stripeSubscriptionId: "sub_test123",
      stripeCustomerId: "cus_test123",
      status: "active",
      priceId: "price_pro_test",
      trialEnd: null,
      userId: "user_abc123",
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(subscriptionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);
    mockExtractSubscriptionData.mockReturnValue(subscriptionData);

    const response = await handler(buildEvent());

    expect(response).toEqual({ data: { received: true } });
    expect(mockUpsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_abc123",
        stripeCustomerId: "cus_test123",
        stripeSubscriptionId: "sub_test123",
      }),
    );
  });

  it("upserts for subscription.updated", async () => {
    const subscriptionObject = makeSubscriptionObject({ status: "past_due" });
    const stripeEvent = {
      type: "customer.subscription.updated",
      data: { object: subscriptionObject },
    };
    const subscriptionData = {
      stripeSubscriptionId: "sub_test123",
      stripeCustomerId: "cus_test123",
      status: "past_due",
      priceId: "price_pro_test",
      trialEnd: null,
      userId: "user_abc123",
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(subscriptionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);
    mockExtractSubscriptionData.mockReturnValue(subscriptionData);
    mockResolveStatusFromStripe.mockReturnValue("past_due");

    const response = await handler(buildEvent());

    expect(response).toEqual({ data: { received: true } });
    expect(mockUpsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: "past_due" }),
    );
  });

  it("marks subscription as canceled for subscription.deleted", async () => {
    const subscriptionObject = makeSubscriptionObject({ status: "canceled" });
    const stripeEvent = {
      type: "customer.subscription.deleted",
      data: { object: subscriptionObject },
    };
    const subscriptionData = {
      stripeSubscriptionId: "sub_test123",
      stripeCustomerId: "cus_test123",
      status: "canceled",
      priceId: null,
      trialEnd: null,
      userId: "user_abc123",
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(subscriptionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);
    mockExtractSubscriptionData.mockReturnValue(subscriptionData);

    const response = await handler(buildEvent());

    expect(response).toEqual({ data: { received: true } });
    expect(mockUpdateSubscriptionByStripeCustomerId).toHaveBeenCalledWith(
      "cus_test123",
      expect.objectContaining({ status: "canceled", plan: "hobby" }),
    );
  });

  it("persists the Stripe customer id on the users row for checkout.session.completed and does not touch subscription rows", async () => {
    // subscription.created carries the correct plan/status/trial data and is
    // always delivered after checkout.session.completed — rely on that event for
    // the subscriptions row. This handler only persists the customer id so the
    // account-deletion sweep can find it even for a schedule-only checkout.
    const sessionObject = {
      id: "cs_test123",
      mode: "subscription",
      customer: "cus_test123",
      subscription: "sub_test123",
      metadata: { userId: "user_abc123" },
      client_reference_id: null,
    };
    const stripeEvent = {
      type: "checkout.session.completed",
      data: { object: sessionObject },
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(sessionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);

    const response = await handler(buildEvent());

    expect(response).toEqual({ data: { received: true } });
    expect(mockSetUserStripeCustomerId).toHaveBeenCalledWith(
      "user_abc123",
      "cus_test123",
    );
    expect(mockUpsertSubscription).not.toHaveBeenCalled();
    expect(mockUpdateSubscriptionByStripeCustomerId).not.toHaveBeenCalled();
  });

  it("resolves the userId from client_reference_id when metadata omits it", async () => {
    const sessionObject = {
      id: "cs_ref_test",
      mode: "subscription",
      customer: "cus_ref123",
      subscription: "sub_ref123",
      metadata: {},
      client_reference_id: "user_ref456",
    };
    const stripeEvent = {
      type: "checkout.session.completed",
      data: { object: sessionObject },
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(sessionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);

    await handler(buildEvent());

    expect(mockSetUserStripeCustomerId).toHaveBeenCalledWith(
      "user_ref456",
      "cus_ref123",
    );
  });

  it("resolves the customer id from an expanded customer object", async () => {
    const sessionObject = {
      id: "cs_expanded",
      mode: "subscription",
      customer: { id: "cus_expanded", object: "customer" },
      subscription: "sub_expanded",
      metadata: { userId: "user_exp" },
      client_reference_id: null,
    };
    const stripeEvent = {
      type: "checkout.session.completed",
      data: { object: sessionObject },
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(sessionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);

    await handler(buildEvent());

    expect(mockSetUserStripeCustomerId).toHaveBeenCalledWith(
      "user_exp",
      "cus_expanded",
    );
  });

  it("skips persisting when the session carries no userId", async () => {
    const sessionObject = {
      id: "cs_no_user",
      mode: "subscription",
      customer: "cus_test123",
      subscription: "sub_test123",
      metadata: {},
      client_reference_id: null,
    };
    const stripeEvent = {
      type: "checkout.session.completed",
      data: { object: sessionObject },
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(sessionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);

    const response = await handler(buildEvent());

    expect(response).toEqual({ data: { received: true } });
    expect(mockSetUserStripeCustomerId).not.toHaveBeenCalled();
  });

  it("skips persisting when the session carries no customer", async () => {
    const sessionObject = {
      id: "cs_no_customer",
      mode: "subscription",
      customer: null,
      subscription: "sub_test123",
      metadata: { userId: "user_abc123" },
      client_reference_id: null,
    };
    const stripeEvent = {
      type: "checkout.session.completed",
      data: { object: sessionObject },
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(sessionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);

    const response = await handler(buildEvent());

    expect(response).toEqual({ data: { received: true } });
    expect(mockSetUserStripeCustomerId).not.toHaveBeenCalled();
  });

  it("propagates a persist failure so Stripe retries the event", async () => {
    const sessionObject = {
      id: "cs_persist_fail",
      mode: "subscription",
      customer: "cus_test123",
      subscription: "sub_test123",
      metadata: { userId: "user_abc123" },
      client_reference_id: null,
    };
    const stripeEvent = {
      type: "checkout.session.completed",
      data: { object: sessionObject },
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(sessionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);
    mockSetUserStripeCustomerId.mockRejectedValueOnce(new Error("db down"));

    await expect(handler(buildEvent())).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it("ignores non-subscription checkout.session.completed events", async () => {
    const sessionObject = {
      id: "cs_payment_test",
      mode: "payment",
      customer: "cus_test123",
      subscription: null,
      metadata: {},
      client_reference_id: null,
    };
    const stripeEvent = {
      type: "checkout.session.completed",
      data: { object: sessionObject },
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(sessionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);

    const response = await handler(buildEvent());

    expect(response).toEqual({ data: { received: true } });
    expect(mockSetUserStripeCustomerId).not.toHaveBeenCalled();
    expect(mockUpsertSubscription).not.toHaveBeenCalled();
  });

  it("ignores unhandled event types without calling any billing utilities", async () => {
    const stripeEvent = {
      type: "payment_intent.created",
      data: { object: {} },
    };

    mockReadRawBody.mockResolvedValue("{}");
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);

    const response = await handler(buildEvent());

    expect(response).toEqual({ data: { received: true } });
    expect(mockUpsertSubscription).not.toHaveBeenCalled();
    expect(mockUpdateSubscriptionByStripeCustomerId).not.toHaveBeenCalled();
  });

  it("converts trialEnd timestamp to a Date when present", async () => {
    const trialEndTimestamp = 1800000000;
    const subscriptionObject = makeSubscriptionObject({
      trial_end: trialEndTimestamp,
    });
    const stripeEvent = {
      type: "customer.subscription.created",
      data: { object: subscriptionObject },
    };
    const subscriptionData = {
      stripeSubscriptionId: "sub_test123",
      stripeCustomerId: "cus_test123",
      status: "trialing",
      priceId: "price_pro_test",
      trialEnd: trialEndTimestamp,
      userId: "user_abc123",
    };

    mockReadRawBody.mockResolvedValue(JSON.stringify(subscriptionObject));
    mockGetHeader.mockReturnValue("t=1234,v1=valid_sig");
    mockConstructStripeEvent.mockReturnValue(stripeEvent);
    mockExtractSubscriptionData.mockReturnValue(subscriptionData);
    mockResolveStatusFromStripe.mockReturnValue("trialing");

    await handler(buildEvent());

    const upsertArgs = mockUpsertSubscription.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(upsertArgs.trialEndsAt).toBeInstanceOf(Date);
    expect((upsertArgs.trialEndsAt as Date).getTime()).toBe(
      trialEndTimestamp * 1000,
    );
  });
});
