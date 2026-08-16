import { beforeEach, describe, expect, it, vi } from "vitest";

// ── DB mock: fluent select/update builders ─────────────────────────────────

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const selectMock = vi.fn(() => ({ from: selectFrom }));

const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
const updateMock = vi.fn(() => ({ set: updateSet }));

vi.mock("../../../server/db", () => ({
  getDb: () => ({ select: selectMock, update: updateMock }),
}));

// A table identity so the assertions catch a query aimed at the wrong table.
vi.mock("../../../server/db/schema", () => ({
  users: "users_table",
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

const { findUserStripeCustomerId, setUserStripeCustomerId } =
  await import("../../../server/utils/users");

describe("findUserStripeCustomerId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectWhere.mockImplementation(() => ({ limit: selectLimit }));
  });

  it("returns the stored customer id from the users table", async () => {
    selectLimit.mockResolvedValueOnce([{ stripeCustomerId: "cus_stored" }]);
    await expect(findUserStripeCustomerId("user_1")).resolves.toBe(
      "cus_stored",
    );
    expect(selectFrom).toHaveBeenCalledWith("users_table");
    expect(selectWhere).toHaveBeenCalledWith(
      expect.objectContaining({ value: "user_1" }),
    );
  });

  it("returns null when the row has no customer id", async () => {
    selectLimit.mockResolvedValueOnce([{ stripeCustomerId: null }]);
    await expect(findUserStripeCustomerId("user_1")).resolves.toBeNull();
  });

  it("returns null when there is no row", async () => {
    selectLimit.mockResolvedValueOnce([]);
    await expect(findUserStripeCustomerId("user_1")).resolves.toBeNull();
  });
});

describe("setUserStripeCustomerId", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    updateWhere.mockImplementation(() => ({ returning: updateReturning }));
  });

  it("persists the customer id onto the users table", async () => {
    updateReturning.mockResolvedValueOnce([{ userId: "user_1" }]);
    await setUserStripeCustomerId("user_1", "cus_new");
    expect(updateMock).toHaveBeenCalledWith("users_table");
    expect(updateSet).toHaveBeenCalledWith({ stripeCustomerId: "cus_new" });
    expect(updateWhere).toHaveBeenCalledWith(
      expect.objectContaining({ value: "user_1" }),
    );
  });

  it("throws when no row was updated so the webhook fails loud and Stripe retries", async () => {
    updateReturning.mockResolvedValueOnce([]);
    await expect(
      setUserStripeCustomerId("user_missing", "cus_new"),
    ).rejects.toThrow(/user_missing/);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("no users row"),
      expect.objectContaining({ userId: "user_missing" }),
    );
  });
});
