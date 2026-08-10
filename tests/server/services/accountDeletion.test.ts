import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock: capture the users delete ─────────────────────────────────────

const usersWhere = vi.fn().mockResolvedValue([]);
const deleteMock = vi.fn(() => ({ where: usersWhere }));

vi.mock("../../../server/db", () => ({
  getDb: () => ({ delete: deleteMock }),
}));

vi.mock("../../../server/db/schema", () => ({
  users: "users_table",
}));

vi.mock("drizzle-orm", () => ({
  eq: (field: unknown, value: unknown) => ({ field, value }),
}));

const mockDeleteClerkUser = vi.fn();

vi.mock("../../../server/utils/clerk", () => ({
  deleteClerkUser: (...args: unknown[]) => mockDeleteClerkUser(...args),
}));

const mockFindSubscriptionByUserId = vi.fn();

vi.mock("../../../server/utils/billing", () => ({
  findSubscriptionByUserId: (...args: unknown[]) =>
    mockFindSubscriptionByUserId(...args),
}));

const mockCancelSubscriptionsForCustomer = vi.fn();

vi.mock("../../../server/services/stripe", () => ({
  cancelSubscriptionsForCustomer: (...args: unknown[]) =>
    mockCancelSubscriptionsForCustomer(...args),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────

const { reconcileAccountDeletion } =
  await import("../../../server/services/accountDeletion");

describe("reconcileAccountDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
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

  it("deletes the Clerk identity by default (in-app path)", async () => {
    await reconcileAccountDeletion("user_123");
    expect(mockDeleteClerkUser).toHaveBeenCalledWith("user_123");
  });

  it("wipes app data but skips the Clerk delete when deleteClerkIdentity is false", async () => {
    await reconcileAccountDeletion("user_123", { deleteClerkIdentity: false });
    expect(deleteMock).toHaveBeenCalledWith("users_table");
    expect(usersWhere).toHaveBeenCalledWith(
      expect.objectContaining({ value: "user_123" }),
    );
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
  });

  it("cancels Stripe billing before wiping app data", async () => {
    await reconcileAccountDeletion("user_123", { deleteClerkIdentity: false });
    expect(
      mockCancelSubscriptionsForCustomer.mock.invocationCallOrder[0],
    ).toBeLessThan(usersWhere.mock.invocationCallOrder[0]);
  });

  it("fails closed (503) without wiping data when the Stripe sweep throws", async () => {
    mockCancelSubscriptionsForCustomer.mockRejectedValueOnce(
      new Error("stripe down"),
    );
    await expect(
      reconcileAccountDeletion("user_123", { deleteClerkIdentity: false }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
  });

  it("skips the sweep but still wipes data when there is no subscription row", async () => {
    mockFindSubscriptionByUserId.mockResolvedValueOnce(null);
    await reconcileAccountDeletion("user_123");
    expect(mockCancelSubscriptionsForCustomer).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledWith("users_table");
  });

  it("skips the sweep and wipes data when the row has a customer id but no subscription id", async () => {
    mockFindSubscriptionByUserId.mockResolvedValueOnce({
      stripeCustomerId: "cus_test123",
      stripeSubscriptionId: null,
    });
    await reconcileAccountDeletion("user_123");
    expect(mockCancelSubscriptionsForCustomer).toHaveBeenCalledWith(
      "cus_test123",
    );
    expect(deleteMock).toHaveBeenCalled();
  });

  it("fails closed (503) without wiping data when a subscription id has no customer id", async () => {
    mockFindSubscriptionByUserId.mockResolvedValueOnce({
      stripeCustomerId: null,
      stripeSubscriptionId: "sub_live_1",
    });
    await expect(reconcileAccountDeletion("user_123")).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(mockCancelSubscriptionsForCustomer).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("skips the sweep and wipes data when the row has neither a customer nor a subscription id", async () => {
    mockFindSubscriptionByUserId.mockResolvedValueOnce({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    await reconcileAccountDeletion("user_123");
    expect(mockCancelSubscriptionsForCustomer).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalled();
  });

  it("flags the canceled-billing-but-active state when the delete fails after a sweep", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    usersWhere.mockRejectedValueOnce(new Error("db down"));
    await expect(reconcileAccountDeletion("user_123")).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("billing canceled but account delete failed"),
      expect.objectContaining({ userId: "user_123" }),
    );
  });
});
