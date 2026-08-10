import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import type { SubscriptionGateway } from "../../../server/services/stripe";
import { sweepCustomerSubscriptions } from "../../../server/services/stripe";

const CUSTOMER_ID = "cus_test123";

function subscription(
  id: string,
  status: Stripe.Subscription.Status,
): Stripe.Subscription {
  return { id, status } as unknown as Stripe.Subscription;
}

function page(
  data: Stripe.Subscription[],
  hasMore = false,
): Stripe.ApiList<Stripe.Subscription> {
  return {
    object: "list",
    data,
    has_more: hasMore,
    url: "/v1/subscriptions",
  } as unknown as Stripe.ApiList<Stripe.Subscription>;
}

function customer(id: string): Stripe.Customer {
  return { id, object: "customer" } as unknown as Stripe.Customer;
}

function resourceMissingError(message: string): Stripe.errors.StripeError {
  return new Stripe.errors.StripeInvalidRequestError({
    message,
    code: "resource_missing",
    type: "invalid_request_error",
  });
}

type GatewayOverrides = {
  list?: ReturnType<typeof vi.fn>;
  cancel?: ReturnType<typeof vi.fn>;
  retrieveCustomer?: ReturnType<typeof vi.fn>;
};

function buildGateway(
  pages: Stripe.ApiList<Stripe.Subscription>[],
  overrides: GatewayOverrides = {},
): {
  gateway: SubscriptionGateway;
  retrieveCustomer: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  if (overrides.list && pages.length > 0) {
    throw new Error(
      "buildGateway: pass pages OR a list override, not both — the pages would be silently discarded",
    );
  }

  const list = overrides.list ?? vi.fn();
  if (!overrides.list) {
    pages.forEach((result) => list.mockResolvedValueOnce(result));
  }

  const cancel =
    overrides.cancel ??
    vi.fn((id: string) => Promise.resolve(subscription(id, "canceled")));

  const retrieveCustomer =
    overrides.retrieveCustomer ??
    vi.fn(() => Promise.resolve(customer(CUSTOMER_ID)));

  return {
    gateway: { retrieveCustomer, list, cancel },
    retrieveCustomer,
    list,
    cancel,
  };
}

describe("sweepCustomerSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("queries all subscriptions for the customer regardless of status", async () => {
    const { gateway, list } = buildGateway([page([])]);

    await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ customer: CUSTOMER_ID, status: "all" }),
    );
  });

  it("cancels a billable subscription that no local row references", async () => {
    const extra = subscription("sub_created_outside_checkout", "active");
    const { gateway, cancel } = buildGateway([page([extra])]);

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(cancel).toHaveBeenCalledWith("sub_created_outside_checkout");
    expect(result.canceledCount).toBe(1);
  });

  it("cancels every non-terminal status and skips terminal ones", async () => {
    const subs = [
      subscription("sub_active", "active"),
      subscription("sub_trialing", "trialing"),
      subscription("sub_past_due", "past_due"),
      subscription("sub_unpaid", "unpaid"),
      subscription("sub_incomplete", "incomplete"),
      subscription("sub_paused", "paused"),
      subscription("sub_canceled", "canceled"),
      subscription("sub_incomplete_expired", "incomplete_expired"),
    ];
    const { gateway, cancel } = buildGateway([page(subs)]);

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(result.canceledCount).toBe(6);
    expect(cancel).not.toHaveBeenCalledWith("sub_canceled");
    expect(cancel).not.toHaveBeenCalledWith("sub_incomplete_expired");
  });

  it("cancels nothing when the customer has only already-canceled subscriptions", async () => {
    const subs = [
      subscription("sub_canceled", "canceled"),
      subscription("sub_incomplete_expired", "incomplete_expired"),
    ];
    const { gateway, cancel } = buildGateway([page(subs)]);

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(cancel).not.toHaveBeenCalled();
    expect(result.canceledCount).toBe(0);
  });

  it("cancels nothing when the customer has no subscriptions", async () => {
    const { gateway, cancel } = buildGateway([page([])]);

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(cancel).not.toHaveBeenCalled();
    expect(result.canceledCount).toBe(0);
  });

  it("paginates until Stripe reports no more results", async () => {
    const first = page([subscription("sub_1", "active")], true);
    const second = page([subscription("sub_2", "active")], false);
    const { gateway, list, cancel } = buildGateway([first, second]);

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ starting_after: "sub_1" }),
    );
    expect(cancel).toHaveBeenCalledWith("sub_2");
    expect(result.canceledCount).toBe(2);
  });

  it("tolerates a subscription already gone (resource_missing)", async () => {
    const { gateway, cancel } = buildGateway([
      page([subscription("sub_racing", "active")]),
    ]);
    cancel.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        message: "No such subscription: 'sub_racing'",
        code: "resource_missing",
        type: "invalid_request_error",
      }),
    );

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(result.canceledCount).toBe(0);
    expect(result.failedSubscriptionIds).toEqual([]);
  });

  it("tolerates a subscription canceled between list and cancel", async () => {
    const { gateway, cancel } = buildGateway([
      page([subscription("sub_racing", "active")]),
    ]);
    cancel.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        message: "A subscription with status 'canceled' may not be updated",
        type: "invalid_request_error",
      }),
    );

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(result.canceledCount).toBe(0);
    expect(result.failedSubscriptionIds).toEqual([]);
  });

  it("records — not rethrows — a cancel Stripe refuses (schedule-managed)", async () => {
    const { gateway } = buildGateway([
      page([subscription("sub_scheduled", "active")]),
    ]);
    gateway.cancel = vi.fn().mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        message:
          "This subscription is managed by a schedule and cannot be canceled",
        type: "invalid_request_error",
      }),
    );

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(result.canceledCount).toBe(0);
    expect(result.failedSubscriptionIds).toEqual(["sub_scheduled"]);
  });

  it("records an unexpected cancel failure instead of aborting", async () => {
    const { gateway } = buildGateway([
      page([subscription("sub_active", "active")]),
    ]);
    gateway.cancel = vi.fn().mockRejectedValueOnce(new Error("network down"));

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(result.failedSubscriptionIds).toEqual(["sub_active"]);
  });

  it("keeps canceling later subscriptions after one fails", async () => {
    const { gateway } = buildGateway([
      page([
        subscription("sub_bad", "active"),
        subscription("sub_good", "active"),
      ]),
    ]);
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(subscription("sub_good", "canceled"));
    gateway.cancel = cancel;

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(cancel).toHaveBeenCalledWith("sub_good");
    expect(result.canceledCount).toBe(1);
    expect(result.failedSubscriptionIds).toEqual(["sub_bad"]);
  });

  it("fails loud when Stripe reports has_more with an empty page", async () => {
    const { gateway } = buildGateway([page([], true)]);

    await expect(
      sweepCustomerSubscriptions(gateway, CUSTOMER_ID),
    ).rejects.toThrow("has_more with an empty");
  });

  it("propagates a failure listing subscriptions", async () => {
    const { gateway, retrieveCustomer } = buildGateway([], {
      list: vi.fn().mockRejectedValueOnce(new Error("list exploded")),
    });

    await expect(
      sweepCustomerSubscriptions(gateway, CUSTOMER_ID),
    ).rejects.toThrow("list exploded");
    // A list failure aborts before the empty-sweep visibility check.
    expect(retrieveCustomer).not.toHaveBeenCalled();
  });

  it("fails loud when listing itself reports the customer is unseeable", async () => {
    // Stripe validates the customer filter on list, so a wrong key can surface
    // as resource_missing on list rather than an empty page — still the
    // wrong-key blind spot, not a generic sweep failure.
    const missing = resourceMissingError("No such customer: 'cus_test123'");
    const { gateway, cancel } = buildGateway([], {
      list: vi.fn().mockRejectedValueOnce(missing),
    });

    const error = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID).catch(
      (caught: unknown) => caught,
    );

    expect((error as Error).message).toContain(
      "Stripe key cannot see customer",
    );
    // The raw Stripe error must survive as `cause` — it's the only link to
    // "No such customer" once the message is flattened at the wire boundary.
    expect((error as Error).cause).toBe(missing);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("fails loud (and logs a greppable line) when an empty sweep can't prove the key sees the customer", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const missing = resourceMissingError("No such customer: 'cus_test123'");
    const { gateway, list, cancel } = buildGateway([page([])], {
      retrieveCustomer: vi.fn().mockRejectedValueOnce(missing),
    });

    const error = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID).catch(
      (caught: unknown) => caught,
    );

    // An empty result under a key that can't see the customer must never read as
    // "no billing": the sweep lists, finds nothing, then refuses on the failed
    // visibility proof rather than canceling/returning success.
    expect((error as Error).message).toContain(
      "Stripe key cannot see customer",
    );
    expect((error as Error).cause).toBe(missing);
    expect(list).toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    // Ops grep this line to distinguish a wrong key from a Stripe outage.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("key cannot see customer"),
      expect.objectContaining({ customerId: CUSTOMER_ID }),
    );
  });

  it("skips the visibility check when the sweep saw a subscription", async () => {
    // Any returned subscription proves the key sees the customer, so a canceled
    // one (a real "already gone" case) proceeds without an extra retrieve.
    const { gateway, retrieveCustomer, cancel } = buildGateway([
      page([subscription("sub_canceled", "canceled")]),
    ]);

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(retrieveCustomer).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(result.canceledCount).toBe(0);
    expect(result.failedSubscriptionIds).toEqual([]);
  });

  it("cancels a live subscription even when the customer retrieve would fail", async () => {
    // With a billable subscription in hand the key is proven, so a transient
    // retrieve failure must not block canceling it (regression guard for the
    // empty-only visibility check).
    const { gateway, retrieveCustomer, cancel } = buildGateway(
      [page([subscription("sub_active", "active")])],
      {
        retrieveCustomer: vi
          .fn()
          .mockRejectedValue(new Error("customers.retrieve down")),
      },
    );

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(retrieveCustomer).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith("sub_active");
    expect(result.canceledCount).toBe(1);
  });

  it("treats a deleted-customer object as visible and proceeds", async () => {
    // A retrieve that returns a { deleted: true } object still proves the key
    // can see the account, so the empty sweep is trustworthy and proceeds.
    const { gateway, retrieveCustomer } = buildGateway([page([])], {
      retrieveCustomer: vi.fn(() =>
        Promise.resolve({
          id: CUSTOMER_ID,
          object: "customer",
          deleted: true,
        } as unknown as Stripe.DeletedCustomer),
      ),
    });

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    // The visibility proof must actually run (and tolerate the deleted object)
    // for this to pass — not merely return a zero count.
    expect(retrieveCustomer).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(retrieveCustomer).toHaveBeenCalledTimes(1);
    expect(result.canceledCount).toBe(0);
  });

  it("propagates a non-missing customer retrieve error unchanged", async () => {
    const { gateway } = buildGateway([page([])], {
      retrieveCustomer: vi
        .fn()
        .mockRejectedValueOnce(new Error("network down")),
    });

    await expect(
      sweepCustomerSubscriptions(gateway, CUSTOMER_ID),
    ).rejects.toThrow("network down");
  });

  it("surfaces partial progress when a later page fails to list", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const first = page([subscription("sub_1", "active")], true);
    const { gateway } = buildGateway([], {
      list: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockRejectedValueOnce(new Error("page 2 exploded")),
      cancel: vi.fn().mockResolvedValue(subscription("sub_1", "canceled")),
    });

    await expect(
      sweepCustomerSubscriptions(gateway, CUSTOMER_ID),
    ).rejects.toThrow("page 2 exploded");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("partial progress"),
      expect.objectContaining({ canceledCount: 1 }),
    );
  });

  it("does not misread a mid-pagination resource_missing as a wrong key", async () => {
    // Page 1 canceled a subscription, proving the key sees the customer. A
    // resource_missing on page 2 (customer deleted mid-sweep, bad cursor) is a
    // race, not the wrong-key blind spot — surface the raw error and keep the
    // partial-progress audit trail rather than crying "key cannot see customer".
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const first = page([subscription("sub_1", "active")], true);
    const { gateway } = buildGateway([], {
      list: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockRejectedValueOnce(
          resourceMissingError("No such customer: 'cus_test123'"),
        ),
      cancel: vi.fn().mockResolvedValue(subscription("sub_1", "canceled")),
    });

    const error = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID).catch(
      (caught: unknown) => caught,
    );

    expect((error as Error).message).toContain("No such customer");
    expect((error as Error).message).not.toContain("Stripe key cannot see");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("partial progress"),
      expect.objectContaining({ canceledCount: 1 }),
    );
  });
});
