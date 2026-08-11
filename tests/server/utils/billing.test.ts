import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("../../../server/db", () => ({
  getDb: () => ({
    insert: insertMock,
    select: selectMock,
    update: updateMock,
  }),
}));

type ConditionNode =
  | { type: "eq"; column: unknown; value: unknown }
  | { type: "isNotNull"; column: unknown }
  | { type: "and"; conditions: ConditionNode[] }
  | { type: "not"; condition: ConditionNode };

vi.mock("drizzle-orm", () => ({
  and: (...conditions: ConditionNode[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  isNotNull: (column: unknown) => ({ type: "isNotNull", column }),
  not: (condition: ConditionNode) => ({ type: "not", condition }),
}));

const {
  findSubscriptionByUserId,
  findSubscriptionByStripeCustomerId,
  upsertSubscription,
  updateSubscriptionByStripeCustomerId,
  resolvePlanFromPriceId,
  resolveStatusFromStripe,
  isValidPlan,
  calculateTrialProgress,
  TRIAL_PERIOD_DAYS,
} = await import("../../../server/utils/billing");

const { subscriptions } = await import("../../../server/db/schema");

type GuardRow = { status: string; stripeSubscriptionId: string | null };

function resolveColumnValue(column: unknown, row: GuardRow): unknown {
  if (column === subscriptions.status) {
    return row.status;
  }
  if (column === subscriptions.stripeSubscriptionId) {
    return row.stripeSubscriptionId;
  }
  throw new Error("guard referenced an unexpected column");
}

// Evaluates the setWhere condition tree built by upsertSubscription against a
// hypothetical existing row, so the ordering guard can be asserted behaviorally
// (true = the upsert would apply, false = it is skipped).
function evaluateCondition(node: ConditionNode, row: GuardRow): boolean {
  if (node.type === "eq") {
    return resolveColumnValue(node.column, row) === node.value;
  }
  if (node.type === "isNotNull") {
    return resolveColumnValue(node.column, row) !== null;
  }
  if (node.type === "and") {
    return node.conditions.every((child) => evaluateCondition(child, row));
  }
  if (node.type === "not") {
    return !evaluateCondition(node.condition, row);
  }
  throw new Error("guard produced an unknown condition node");
}

const SAMPLE_SUBSCRIPTION = {
  id: "sub-uuid-1",
  userId: "user_abc123",
  plan: "hobby",
  status: "trialing",
  trialEndsAt: null,
  stripeCustomerId: "cus_test123",
  stripeSubscriptionId: "sub_test123",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

function makeSelectChain(resolvedRows: unknown[]) {
  const limit = vi.fn(() => Promise.resolve(resolvedRows));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { from, where, limit };
}

function makeInsertChain() {
  const onConflictDoUpdate = vi.fn(() => Promise.resolve());
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  return { values, onConflictDoUpdate };
}

function makeUpdateChain(returnedRows: unknown[] = [{ id: "sub-uuid-1" }]) {
  const returning = vi.fn(() => Promise.resolve(returnedRows));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  return { set, where, returning };
}

beforeEach(() => {
  selectMock.mockReset();
  insertMock.mockReset();
  updateMock.mockReset();
  delete process.env.STRIPE_PRO_PRICE_ID;
  delete process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findSubscriptionByUserId", () => {
  it("returns the subscription row when found", async () => {
    const chain = makeSelectChain([SAMPLE_SUBSCRIPTION]);
    selectMock.mockReturnValue({ from: chain.from });

    const result = await findSubscriptionByUserId("user_abc123");

    expect(result).toEqual(SAMPLE_SUBSCRIPTION);
  });

  it("returns null when no subscription is found", async () => {
    const chain = makeSelectChain([]);
    selectMock.mockReturnValue({ from: chain.from });

    const result = await findSubscriptionByUserId("user_xyz");

    expect(result).toBeNull();
  });
});

describe("findSubscriptionByStripeCustomerId", () => {
  it("returns the subscription row when found", async () => {
    const chain = makeSelectChain([SAMPLE_SUBSCRIPTION]);
    selectMock.mockReturnValue({ from: chain.from });

    const result = await findSubscriptionByStripeCustomerId("cus_test123");

    expect(result).toEqual(SAMPLE_SUBSCRIPTION);
  });

  it("returns null when no subscription is found", async () => {
    const chain = makeSelectChain([]);
    selectMock.mockReturnValue({ from: chain.from });

    const result = await findSubscriptionByStripeCustomerId("cus_unknown");

    expect(result).toBeNull();
  });
});

describe("upsertSubscription", () => {
  it("calls insert with the correct values and upserts on conflict", async () => {
    const chain = makeInsertChain();
    insertMock.mockReturnValue({ values: chain.values });

    await upsertSubscription({
      userId: "user_abc123",
      plan: "pro",
      status: "active",
      trialEndsAt: null,
      stripeCustomerId: "cus_test123",
      stripeSubscriptionId: "sub_test123",
    });

    expect(insertMock).toHaveBeenCalled();
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_abc123",
        plan: "pro",
        status: "active",
        stripeCustomerId: "cus_test123",
        stripeSubscriptionId: "sub_test123",
      }),
    );
    expect(chain.onConflictDoUpdate).toHaveBeenCalled();
  });

  it("passes trialEndsAt when provided", async () => {
    const chain = makeInsertChain();
    insertMock.mockReturnValue({ values: chain.values });

    const trialDate = new Date("2024-02-01T00:00:00Z");

    await upsertSubscription({
      userId: "user_abc123",
      plan: "hobby",
      status: "trialing",
      trialEndsAt: trialDate,
      stripeCustomerId: "cus_test123",
      stripeSubscriptionId: "sub_test123",
    });

    const callArgs = chain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.trialEndsAt).toBe(trialDate);
  });

  async function captureUpsertGuard(
    stripeSubscriptionId: string,
  ): Promise<ConditionNode> {
    const chain = makeInsertChain();
    insertMock.mockReturnValue({ values: chain.values });

    await upsertSubscription({
      userId: "user_abc123",
      plan: "pro",
      status: "active",
      trialEndsAt: null,
      stripeCustomerId: "cus_test123",
      stripeSubscriptionId,
    });

    const conflictArgs = chain.onConflictDoUpdate.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(conflictArgs.setWhere).toBeDefined();
    return conflictArgs.setWhere as ConditionNode;
  }

  it("guards the upsert so a stale update cannot revive a canceled subscription", async () => {
    const guard = await captureUpsertGuard("sub_test123");

    const wouldApply = evaluateCondition(guard, {
      status: "canceled",
      stripeSubscriptionId: "sub_test123",
    });

    expect(wouldApply).toBe(false);
  });

  it("still applies an in-order update to a live subscription", async () => {
    const guard = await captureUpsertGuard("sub_test123");

    const wouldApply = evaluateCondition(guard, {
      status: "active",
      stripeSubscriptionId: "sub_test123",
    });

    expect(wouldApply).toBe(true);
  });

  it("still applies when a new subscription replaces a canceled one (resubscribe)", async () => {
    const guard = await captureUpsertGuard("sub_new456");

    const wouldApply = evaluateCondition(guard, {
      status: "canceled",
      stripeSubscriptionId: "sub_old123",
    });

    expect(wouldApply).toBe(true);
  });

  it("still applies when the existing canceled row has a null stripeSubscriptionId", async () => {
    const guard = await captureUpsertGuard("sub_test123");

    const wouldApply = evaluateCondition(guard, {
      status: "canceled",
      stripeSubscriptionId: null,
    });

    expect(wouldApply).toBe(true);
  });
});

describe("updateSubscriptionByStripeCustomerId", () => {
  it("calls update with the correct status and updatedAt", async () => {
    const chain = makeUpdateChain();
    updateMock.mockReturnValue({ set: chain.set });

    await updateSubscriptionByStripeCustomerId("cus_test123", {
      status: "canceled",
    });

    expect(updateMock).toHaveBeenCalled();
    const setArgs = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs.status).toBe("canceled");
    expect(setArgs.updatedAt).toBeInstanceOf(Date);
  });

  it("logs a warning when no row is found for the given customer", async () => {
    const chain = makeUpdateChain([]);
    updateMock.mockReturnValue({ set: chain.set });
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    await updateSubscriptionByStripeCustomerId("cus_unknown", {
      status: "canceled",
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("no row found for customer"),
      expect.objectContaining({ stripeCustomerId: "cus_unknown" }),
    );

    consoleWarnSpy.mockRestore();
  });
});

describe("resolvePlanFromPriceId", () => {
  it("returns hobby when priceId is null", () => {
    expect(resolvePlanFromPriceId(null)).toBe("hobby");
  });

  it("returns hobby when priceId does not match any known price", () => {
    expect(resolvePlanFromPriceId("price_unknown")).toBe("hobby");
  });

  it("returns pro when priceId matches STRIPE_PRO_PRICE_ID", () => {
    process.env.STRIPE_PRO_PRICE_ID = "price_pro_monthly";
    expect(resolvePlanFromPriceId("price_pro_monthly")).toBe("pro");
  });

  it("returns pro when priceId matches STRIPE_PRO_ANNUAL_PRICE_ID", () => {
    process.env.STRIPE_PRO_ANNUAL_PRICE_ID = "price_pro_annual";
    expect(resolvePlanFromPriceId("price_pro_annual")).toBe("pro");
  });
});

describe("resolveStatusFromStripe", () => {
  it.each([
    ["active", "active"],
    ["trialing", "trialing"],
    ["past_due", "past_due"],
    ["canceled", "canceled"],
    ["incomplete", "incomplete"],
  ])(
    "maps known Stripe status '%s' to '%s'",
    (stripeStatus, expectedStatus) => {
      expect(resolveStatusFromStripe(stripeStatus)).toBe(expectedStatus);
    },
  );

  it("returns incomplete for an unknown Stripe status", () => {
    expect(resolveStatusFromStripe("unpaid")).toBe("incomplete");
    expect(resolveStatusFromStripe("paused")).toBe("incomplete");
  });
});

describe("isValidPlan", () => {
  it("returns true for hobby", () => {
    expect(isValidPlan("hobby")).toBe(true);
  });

  it("returns true for pro", () => {
    expect(isValidPlan("pro")).toBe(true);
  });

  it("returns false for an unknown plan", () => {
    expect(isValidPlan("enterprise")).toBe(false);
    expect(isValidPlan("")).toBe(false);
  });
});

describe("calculateTrialProgress", () => {
  it("matches the trial length used by Stripe checkout sessions", () => {
    expect(TRIAL_PERIOD_DAYS).toBe(14);
  });

  it("reports 0 days left and 100% elapsed the instant the trial ends", () => {
    const now = new Date("2026-06-27T00:00:00Z");
    const result = calculateTrialProgress(now, now);

    expect(result).toEqual({ daysLeft: 0, percentElapsed: 100 });
  });

  it("reports the full trial length remaining and 0% elapsed at the start", () => {
    const now = new Date("2026-06-13T00:00:00Z");
    const trialEndsAt = new Date("2026-06-27T00:00:00Z");

    const result = calculateTrialProgress(trialEndsAt, now);

    expect(result).toEqual({ daysLeft: 14, percentElapsed: 0 });
  });

  it("computes partial progress midway through the trial", () => {
    const now = new Date("2026-06-27T00:00:00Z");
    const trialEndsAt = new Date("2026-07-01T00:00:00Z");

    const result = calculateTrialProgress(trialEndsAt, now);

    expect(result).toEqual({ daysLeft: 4, percentElapsed: 71 });
  });

  it("clamps daysLeft to 0 and percentElapsed to 100 for an already-expired trial", () => {
    const now = new Date("2026-07-10T00:00:00Z");
    const trialEndsAt = new Date("2026-07-01T00:00:00Z");

    const result = calculateTrialProgress(trialEndsAt, now);

    expect(result).toEqual({ daysLeft: 0, percentElapsed: 100 });
  });

  it("defaults `now` to the current time when omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T00:00:00Z"));

    const result = calculateTrialProgress(new Date("2026-07-01T00:00:00Z"));

    expect(result).toEqual({ daysLeft: 4, percentElapsed: 71 });

    vi.useRealTimers();
  });
});
