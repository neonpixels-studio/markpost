import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const mockFindSubscriptionByUserId = vi.fn();
const mockCreateCheckoutSession = vi.fn();

vi.mock("../../../../server/utils/billing", () => ({
  findSubscriptionByUserId: (...args: unknown[]) =>
    mockFindSubscriptionByUserId(...args),
}));

vi.mock("../../../../server/services/stripe", () => ({
  createCheckoutSession: (...args: unknown[]) =>
    mockCreateCheckoutSession(...args),
}));

vi.mock("../../../../server/utils/appUrl", () => ({
  buildAppUrl: () => "http://localhost:3000",
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

const mockReadBody = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const handler = (await import("../../../../server/api/billing/checkout.post"))
  .default;

const USER_ID = "user_abc123";

function buildEvent(contextUserId: string | undefined): H3Event {
  return { context: { userId: contextUserId } } as unknown as H3Event;
}

function stubRequireUser(returnedUserId: string | undefined) {
  vi.stubGlobal("requireUser", (event: H3Event) => {
    const contextUserId = (event.context as { userId?: string }).userId;
    if (!contextUserId) {
      throw mockCreateError({
        statusCode: 401,
        data: {
          errors: [
            {
              status: "401",
              title: "Unauthorized",
              detail: "Authentication is required to access this resource.",
            },
          ],
        },
      });
    }

    return returnedUserId ?? contextUserId;
  });
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readBody", mockReadBody);
  stubRequireUser(USER_ID);
  mockCreateError.mockClear();
  mockReadBody.mockClear();
  mockFindSubscriptionByUserId.mockReset();
  mockCreateCheckoutSession.mockReset();
  process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";
  delete process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.STRIPE_PRO_PRICE_ID;
  delete process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
});

describe("POST /api/billing/checkout", () => {
  it("throws 401 when the user is not authenticated", async () => {
    await expect(handler(buildEvent(undefined))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockCreateError).toHaveBeenCalledWith({
      statusCode: 401,
      data: {
        errors: [
          expect.objectContaining({ status: "401", title: "Unauthorized" }),
        ],
      },
    });
  });

  it("throws 422 when priceKey is missing", async () => {
    mockReadBody.mockResolvedValue({});
    mockFindSubscriptionByUserId.mockResolvedValue(null);

    await expect(handler(buildEvent(USER_ID))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 422 }),
    );
  });

  it("throws 422 when priceKey is invalid", async () => {
    mockReadBody.mockResolvedValue({ priceKey: "enterprise" });
    mockFindSubscriptionByUserId.mockResolvedValue(null);

    await expect(handler(buildEvent(USER_ID))).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 422 }),
    );
  });

  it("throws 503 when STRIPE_PRO_PRICE_ID is not set", async () => {
    delete process.env.STRIPE_PRO_PRICE_ID;
    mockReadBody.mockResolvedValue({ priceKey: "pro" });
    mockFindSubscriptionByUserId.mockResolvedValue(null);

    await expect(handler(buildEvent(USER_ID))).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503 }),
    );
  });

  it("returns the checkout URL for a new user with no existing subscription", async () => {
    mockReadBody.mockResolvedValue({ priceKey: "pro" });
    mockFindSubscriptionByUserId.mockResolvedValue(null);
    mockCreateCheckoutSession.mockResolvedValue({
      url: "https://checkout.stripe.com/test-session",
    });

    const response = await handler(buildEvent(USER_ID));

    expect(response).toEqual({
      data: { url: "https://checkout.stripe.com/test-session" },
    });
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: null,
        priceId: "price_pro_test",
        userId: USER_ID,
        isReturningCustomer: false,
      }),
    );
  });

  it("passes isReturningCustomer=true and existing stripeCustomerId when user already has a subscription", async () => {
    mockReadBody.mockResolvedValue({ priceKey: "pro" });
    mockFindSubscriptionByUserId.mockResolvedValue({
      stripeCustomerId: "cus_existing123",
    });
    mockCreateCheckoutSession.mockResolvedValue({
      url: "https://checkout.stripe.com/test-session",
    });

    await handler(buildEvent(USER_ID));

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_existing123",
        isReturningCustomer: true,
      }),
    );
  });

  it("uses STRIPE_PRO_ANNUAL_PRICE_ID when priceKey is pro_annual and env var is set", async () => {
    process.env.STRIPE_PRO_ANNUAL_PRICE_ID = "price_annual_test";
    mockReadBody.mockResolvedValue({ priceKey: "pro_annual" });
    mockFindSubscriptionByUserId.mockResolvedValue(null);
    mockCreateCheckoutSession.mockResolvedValue({
      url: "https://checkout.stripe.com/annual-session",
    });

    await handler(buildEvent(USER_ID));

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: "price_annual_test" }),
    );
  });

  it("throws 503 when priceKey is pro_annual but STRIPE_PRO_ANNUAL_PRICE_ID is not set", async () => {
    mockReadBody.mockResolvedValue({ priceKey: "pro_annual" });
    mockFindSubscriptionByUserId.mockResolvedValue(null);

    await expect(handler(buildEvent(USER_ID))).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503 }),
    );
  });
});
