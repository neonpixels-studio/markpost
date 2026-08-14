import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";

const mockFindSubscriptionByUserId = vi.fn();
const mockCreateCustomerPortalSession = vi.fn();

vi.mock("../../../../server/utils/billing", () => ({
  findSubscriptionByUserId: (...args: unknown[]) =>
    mockFindSubscriptionByUserId(...args),
}));

vi.mock("../../../../server/services/stripe", () => ({
  createCustomerPortalSession: (...args: unknown[]) =>
    mockCreateCustomerPortalSession(...args),
}));

vi.mock("../../../../server/utils/appUrl", () => ({
  buildAppUrl: () => "http://localhost:3000",
}));

const mockCreateError = vi.fn((options: object) => {
  const error = new Error("createError");
  Object.assign(error, options);
  return error;
});

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

const handler = (await import("../../../../server/api/billing/portal.post"))
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
  stubRequireUser(USER_ID);
  mockCreateError.mockClear();
  mockFindSubscriptionByUserId.mockReset();
  mockCreateCustomerPortalSession.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/billing/portal", () => {
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

  it("throws 404 when the user has no subscription", async () => {
    mockFindSubscriptionByUserId.mockResolvedValue(null);

    await expect(handler(buildEvent(USER_ID))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it("throws 404 when the subscription has no stripeCustomerId", async () => {
    mockFindSubscriptionByUserId.mockResolvedValue({
      stripeCustomerId: null,
    });

    await expect(handler(buildEvent(USER_ID))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it("returns the portal URL when the user has a Stripe customer", async () => {
    mockFindSubscriptionByUserId.mockResolvedValue({
      stripeCustomerId: "cus_test123",
    });
    mockCreateCustomerPortalSession.mockResolvedValue({
      url: "https://billing.stripe.com/portal/session_test",
    });

    const response = await handler(buildEvent(USER_ID));

    expect(response).toEqual({
      data: { url: "https://billing.stripe.com/portal/session_test" },
    });
    expect(mockCreateCustomerPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_test123",
      }),
    );
  });
});
