import { describe, it, expect, vi, beforeEach } from "vitest";
import type { H3Event } from "h3";
import { createMockCreateError } from "../../helpers";

// ── DB mock: capture the users delete ─────────────────────────────────────

const usersWhere = vi.fn().mockResolvedValue([]);
const deleteMock = vi.fn(() => ({ where: usersWhere }));

const mockDb = {
  delete: deleteMock,
};

vi.mock("../../../../server/db", () => ({
  getDb: () => mockDb,
}));

vi.mock("../../../../server/db/schema", () => ({
  users: "users_table",
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: unknown, value: unknown) => ({ field, value }),
}));

const mockDeleteClerkUser = vi.fn();

vi.mock("../../../../server/utils/clerk", () => ({
  deleteClerkUser: mockDeleteClerkUser,
}));

const mockFindSubscriptionByUserId = vi.fn();

vi.mock("../../../../server/utils/billing", () => ({
  findSubscriptionByUserId: (...args: unknown[]) =>
    mockFindSubscriptionByUserId(...args),
}));

const mockCancelSubscriptionsForCustomer = vi.fn();

vi.mock("../../../../server/services/stripe", () => ({
  cancelSubscriptionsForCustomer: (...args: unknown[]) =>
    mockCancelSubscriptionsForCustomer(...args),
}));

// ── H3 globals ────────────────────────────────────────────────────────────

const mockCreateError = createMockCreateError();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);
vi.stubGlobal("createError", mockCreateError);

// ── Import AFTER mocks ────────────────────────────────────────────────────

const { default: handler } =
  await import("../../../../server/api/account/index.delete");

// ── Helpers ───────────────────────────────────────────────────────────────

function buildEvent(userId: string | undefined): H3Event {
  return { context: { userId } } as unknown as H3Event;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("DELETE /api/account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockCreateError.mockImplementation((options: object) => {
      const error = new Error("createError");
      Object.assign(error, options);
      return error;
    });
    usersWhere.mockResolvedValue([]);
    deleteMock.mockImplementation(() => ({ where: usersWhere }));
    mockDeleteClerkUser.mockResolvedValue(undefined);
    mockFindSubscriptionByUserId.mockResolvedValue({
      stripeCustomerId: "cus_test123",
      stripeSubscriptionId: "sub_test123",
    });
    mockCancelSubscriptionsForCustomer.mockResolvedValue({
      canceledCount: 1,
      failedSubscriptionIds: [],
    });
  });

  it("throws 401 when the request is unauthenticated", async () => {
    const event = buildEvent(undefined);
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it("deletes the users row so every user-owned table cascades", async () => {
    await handler(buildEvent("user_123"));
    expect(deleteMock).toHaveBeenCalledWith("users_table");
  });

  it("scopes the delete to the authenticated userId", async () => {
    await handler(buildEvent("user_123"));
    expect(usersWhere).toHaveBeenCalledWith(
      expect.objectContaining({ value: "user_123" }),
    );
  });

  it("deletes the Clerk user for the authenticated userId", async () => {
    await handler(buildEvent("user_123"));
    expect(mockDeleteClerkUser).toHaveBeenCalledWith("user_123");
  });

  it("wipes app data before deleting the Clerk identity", async () => {
    await handler(buildEvent("user_123"));
    expect(usersWhere.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteClerkUser.mock.invocationCallOrder[0],
    );
  });

  it("returns { meta: { deleted: true } } on success", async () => {
    const result = await handler(buildEvent("user_123"));
    expect(result).toEqual({ meta: { deleted: true } });
  });

  it("propagates errors through apiErrorHandler when the db delete throws", async () => {
    usersWhere.mockRejectedValueOnce(new Error("db error"));
    await expect(handler(buildEvent("user_123"))).rejects.toThrow();
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
  });

  it("propagates errors through apiErrorHandler when Clerk deletion throws", async () => {
    mockDeleteClerkUser.mockRejectedValueOnce(new Error("clerk error"));
    await expect(handler(buildEvent("user_123"))).rejects.toThrow();
  });

  it("sweeps the customer's Stripe subscriptions on the stored customer id", async () => {
    await handler(buildEvent("user_123"));
    expect(mockFindSubscriptionByUserId).toHaveBeenCalledWith("user_123");
    expect(mockCancelSubscriptionsForCustomer).toHaveBeenCalledWith(
      "cus_test123",
    );
  });

  it("cancels by customer even when the local subscription id is missing", async () => {
    mockFindSubscriptionByUserId.mockResolvedValueOnce({
      stripeCustomerId: "cus_test123",
      stripeSubscriptionId: null,
    });
    await handler(buildEvent("user_123"));
    expect(mockCancelSubscriptionsForCustomer).toHaveBeenCalledWith(
      "cus_test123",
    );
  });

  it("cancels Stripe billing before wiping app data", async () => {
    await handler(buildEvent("user_123"));
    expect(
      mockCancelSubscriptionsForCustomer.mock.invocationCallOrder[0],
    ).toBeLessThan(usersWhere.mock.invocationCallOrder[0]);
  });

  it("skips Stripe when the user has no subscription row", async () => {
    mockFindSubscriptionByUserId.mockResolvedValueOnce(null);
    await handler(buildEvent("user_123"));
    expect(mockCancelSubscriptionsForCustomer).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalled();
  });

  it("skips Stripe and logs when the row has neither a customer nor a subscription id", async () => {
    mockFindSubscriptionByUserId.mockResolvedValueOnce({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await handler(buildEvent("user_123"));
    expect(mockCancelSubscriptionsForCustomer).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing Stripe customer id"),
      expect.objectContaining({ userId: "user_123" }),
    );
  });

  it("fails closed (503) without deleting when the row has a subscription id but no customer id", async () => {
    mockFindSubscriptionByUserId.mockResolvedValueOnce({
      stripeCustomerId: null,
      stripeSubscriptionId: "sub_live_1",
    });
    await expect(handler(buildEvent("user_123"))).rejects.toMatchObject({
      statusCode: 503,
      data: {
        errors: [
          expect.objectContaining({
            status: "503",
            detail: expect.stringContaining("was not deleted"),
          }),
        ],
      },
    });
    expect(mockCancelSubscriptionsForCustomer).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
  });

  it("aborts the delete with a 503 (fail closed) and does not wipe app data when the Stripe sweep throws", async () => {
    mockCancelSubscriptionsForCustomer.mockRejectedValueOnce(
      new Error("stripe error"),
    );
    await expect(handler(buildEvent("user_123"))).rejects.toMatchObject({
      statusCode: 503,
      data: {
        errors: [
          expect.objectContaining({
            status: "503",
            detail: expect.stringContaining("was not deleted"),
          }),
        ],
      },
    });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
  });

  it("flags the canceled-billing-but-still-active state when a later delete fails", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockDeleteClerkUser.mockRejectedValueOnce(new Error("clerk error"));
    await expect(handler(buildEvent("user_123"))).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("billing canceled but account delete failed"),
      expect.objectContaining({ userId: "user_123" }),
    );
  });

  it("does not flag canceled-billing when the delete fails and nothing was swept", async () => {
    mockFindSubscriptionByUserId.mockResolvedValueOnce(null);
    usersWhere.mockRejectedValueOnce(new Error("db error"));
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await expect(handler(buildEvent("user_123"))).rejects.toThrow();
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("billing canceled but account delete failed"),
      expect.anything(),
    );
  });
});
