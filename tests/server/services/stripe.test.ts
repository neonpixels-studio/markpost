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

function scheduledSubscription(
  id: string,
  scheduleId: string,
  status: Stripe.Subscription.Status = "active",
): Stripe.Subscription {
  return { id, status, schedule: scheduleId } as unknown as Stripe.Subscription;
}

// The error Stripe returns when a direct cancel is refused because a schedule
// manages the subscription — the sole trigger for the release-and-retry path.
function scheduleManagedCancelError(): Stripe.errors.StripeInvalidRequestError {
  return new Stripe.errors.StripeInvalidRequestError({
    message:
      "This subscription is managed by a schedule and cannot be canceled",
    type: "invalid_request_error",
  });
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

function resourceMissingError(message: string): Stripe.errors.StripeError {
  return new Stripe.errors.StripeInvalidRequestError({
    message,
    code: "resource_missing",
    type: "invalid_request_error",
  });
}

function buildGateway(pages: Stripe.ApiList<Stripe.Subscription>[]): {
  gateway: SubscriptionGateway;
  list: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  releaseSchedule: ReturnType<typeof vi.fn>;
  retrieveCustomer: ReturnType<typeof vi.fn>;
} {
  const list = vi.fn();
  pages.forEach((result) => list.mockResolvedValueOnce(result));

  const cancel = vi.fn((id: string) =>
    Promise.resolve(subscription(id, "canceled")),
  );

  const releaseSchedule = vi.fn((scheduleId: string) =>
    Promise.resolve({ id: scheduleId } as Stripe.SubscriptionSchedule),
  );

  const retrieveCustomer = vi.fn((customerId: string) =>
    Promise.resolve({ id: customerId } as Stripe.Customer),
  );

  return {
    gateway: { list, cancel, releaseSchedule, retrieveCustomer },
    list,
    cancel,
    releaseSchedule,
    retrieveCustomer,
  };
}

describe("sweepCustomerSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
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
    const { gateway, list, cancel, retrieveCustomer } = buildGateway([
      first,
      second,
    ]);

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(retrieveCustomer).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ starting_after: "sub_1" }),
    );
    expect(cancel).toHaveBeenCalledWith("sub_2");
    expect(result.canceledCount).toBe(2);
  });

  it("confirms the customer is visible before sweeping subscriptions", async () => {
    const { gateway, retrieveCustomer, list } = buildGateway([page([])]);

    await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(retrieveCustomer).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(retrieveCustomer.mock.invocationCallOrder[0]).toBeLessThan(
      list.mock.invocationCallOrder[0],
    );
  });

  it("fails loud and never lists when the key can't see the customer (resource_missing on retrieve)", async () => {
    const { gateway, list, cancel, retrieveCustomer } = buildGateway([
      page([subscription("sub_active", "active")]),
    ]);
    retrieveCustomer.mockRejectedValueOnce(
      resourceMissingError(`No such customer: '${CUSTOMER_ID}'`),
    );

    await expect(
      sweepCustomerSubscriptions(gateway, CUSTOMER_ID),
    ).rejects.toThrow("not visible");
    expect(list).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("propagates a non-resource_missing customer retrieve failure (fails closed)", async () => {
    const { gateway, list, retrieveCustomer } = buildGateway([page([])]);
    retrieveCustomer.mockRejectedValueOnce(new Error("stripe 503"));

    await expect(
      sweepCustomerSubscriptions(gateway, CUSTOMER_ID),
    ).rejects.toThrow("stripe 503");
    expect(list).not.toHaveBeenCalled();
  });

  it("does not mistake a non-resource_missing Stripe retrieve error for an invisible customer", async () => {
    const { gateway, list, retrieveCustomer } = buildGateway([page([])]);
    retrieveCustomer.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        message: "Too many requests",
        code: "rate_limit",
        type: "invalid_request_error",
      }),
    );

    await expect(
      sweepCustomerSubscriptions(gateway, CUSTOMER_ID),
    ).rejects.toThrow("Too many requests");
    expect(list).not.toHaveBeenCalled();
  });

  it("proceeds when the customer is visible but already deleted", async () => {
    const { gateway, retrieveCustomer } = buildGateway([page([])]);
    retrieveCustomer.mockResolvedValueOnce({
      id: CUSTOMER_ID,
      deleted: true,
    } as Stripe.DeletedCustomer);

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(result.canceledCount).toBe(0);
    expect(result.failedSubscriptionIds).toEqual([]);
  });

  it("tolerates a subscription already gone (resource_missing) once the customer is visible", async () => {
    const { gateway, cancel } = buildGateway([
      page([subscription("sub_racing", "active")]),
    ]);
    cancel.mockRejectedValueOnce(
      resourceMissingError("No such subscription: 'sub_racing'"),
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

  it("releases the managing schedule and retries the cancel when Stripe refuses a schedule-managed cancel", async () => {
    const { gateway, releaseSchedule } = buildGateway([
      page([scheduledSubscription("sub_scheduled", "sub_sched_abc")]),
    ]);
    gateway.cancel = vi
      .fn()
      .mockRejectedValueOnce(scheduleManagedCancelError())
      .mockResolvedValueOnce(subscription("sub_scheduled", "canceled"));

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(releaseSchedule).toHaveBeenCalledWith("sub_sched_abc");
    expect(gateway.cancel).toHaveBeenCalledTimes(2);
    expect(result.canceledCount).toBe(1);
    expect(result.failedSubscriptionIds).toEqual([]);
  });

  it("releases the schedule between the refused cancel and the retry cancel", async () => {
    const { gateway, releaseSchedule } = buildGateway([
      page([scheduledSubscription("sub_scheduled", "sub_sched_abc")]),
    ]);
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(scheduleManagedCancelError())
      .mockResolvedValueOnce(subscription("sub_scheduled", "canceled"));
    gateway.cancel = cancel;

    await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    const releaseOrder = releaseSchedule.mock.invocationCallOrder[0];
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(releaseOrder);
    expect(releaseOrder).toBeLessThan(cancel.mock.invocationCallOrder[1]);
  });

  it("resolves the schedule id from an expanded schedule object", async () => {
    const expanded = {
      id: "sub_expanded",
      status: "active",
      schedule: { id: "sub_sched_expanded" },
    } as unknown as Stripe.Subscription;
    const { gateway, releaseSchedule } = buildGateway([page([expanded])]);
    gateway.cancel = vi
      .fn()
      .mockRejectedValueOnce(scheduleManagedCancelError())
      .mockResolvedValueOnce(subscription("sub_expanded", "canceled"));

    await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(releaseSchedule).toHaveBeenCalledWith("sub_sched_expanded");
  });

  it("does not release the schedule of an already-terminal subscription", async () => {
    const { gateway, cancel, releaseSchedule } = buildGateway([
      page([scheduledSubscription("sub_done", "sub_sched_done", "canceled")]),
    ]);

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(releaseSchedule).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(result.canceledCount).toBe(0);
  });

  it("does not release the schedule when the direct cancel succeeds", async () => {
    const { gateway, cancel, releaseSchedule } = buildGateway([
      page([scheduledSubscription("sub_ok", "sub_sched_ok")]),
    ]);

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(releaseSchedule).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith("sub_ok");
    expect(result.canceledCount).toBe(1);
  });

  it("does not release the schedule when the cancel fails for a non-schedule reason", async () => {
    const { gateway, releaseSchedule } = buildGateway([
      page([scheduledSubscription("sub_scheduled", "sub_sched_abc")]),
    ]);
    gateway.cancel = vi.fn().mockRejectedValueOnce(new Error("network down"));

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(releaseSchedule).not.toHaveBeenCalled();
    expect(result.canceledCount).toBe(0);
    expect(result.failedSubscriptionIds).toEqual(["sub_scheduled"]);
  });

  it("fails loud when the retry cancel is still refused after releasing the schedule", async () => {
    const { gateway, releaseSchedule } = buildGateway([
      page([scheduledSubscription("sub_scheduled", "sub_sched_abc")]),
    ]);
    gateway.cancel = vi
      .fn()
      .mockRejectedValueOnce(scheduleManagedCancelError())
      .mockRejectedValueOnce(scheduleManagedCancelError());

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(releaseSchedule).toHaveBeenCalledWith("sub_sched_abc");
    expect(result.canceledCount).toBe(0);
    expect(result.failedSubscriptionIds).toEqual(["sub_scheduled"]);
  });

  it("fails loud without retrying when the cancel is schedule-refused but no schedule id is present", async () => {
    const { gateway, releaseSchedule } = buildGateway([
      page([subscription("sub_no_sched", "active")]),
    ]);
    const cancel = vi.fn().mockRejectedValueOnce(scheduleManagedCancelError());
    gateway.cancel = cancel;

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(releaseSchedule).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result.canceledCount).toBe(0);
    expect(result.failedSubscriptionIds).toEqual(["sub_no_sched"]);
  });

  it("counts nothing and records no failure when the retry cancel races to already-canceled", async () => {
    const { gateway, releaseSchedule } = buildGateway([
      page([scheduledSubscription("sub_scheduled", "sub_sched_abc")]),
    ]);
    gateway.cancel = vi
      .fn()
      .mockRejectedValueOnce(scheduleManagedCancelError())
      .mockRejectedValueOnce(
        new Stripe.errors.StripeInvalidRequestError({
          message: "A subscription with status 'canceled' may not be updated",
          type: "invalid_request_error",
        }),
      );

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(releaseSchedule).toHaveBeenCalledTimes(1);
    expect(result.canceledCount).toBe(0);
    expect(result.failedSubscriptionIds).toEqual([]);
  });

  it("fails loud when the retry cancel fails for a transient reason after the schedule was released", async () => {
    const { gateway, releaseSchedule } = buildGateway([
      page([scheduledSubscription("sub_scheduled", "sub_sched_abc")]),
    ]);
    gateway.cancel = vi
      .fn()
      .mockRejectedValueOnce(scheduleManagedCancelError())
      .mockRejectedValueOnce(new Error("stripe 503"));

    const result = await sweepCustomerSubscriptions(gateway, CUSTOMER_ID);

    expect(releaseSchedule).toHaveBeenCalledTimes(1);
    expect(result.canceledCount).toBe(0);
    expect(result.failedSubscriptionIds).toEqual(["sub_scheduled"]);
  });

  it("fails loud when releasing the schedule itself fails", async () => {
    const { gateway } = buildGateway([
      page([scheduledSubscription("sub_scheduled", "sub_sched_abc")]),
    ]);
    gateway.cancel = vi
      .fn()
      .mockRejectedValueOnce(scheduleManagedCancelError());
    gateway.releaseSchedule = vi
      .fn()
      .mockRejectedValueOnce(new Error("release boom"));

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
    const list = vi.fn().mockRejectedValueOnce(new Error("list exploded"));
    const gateway: SubscriptionGateway = {
      list,
      cancel: vi.fn(),
      releaseSchedule: vi.fn(),
      retrieveCustomer: vi.fn().mockResolvedValue({ id: CUSTOMER_ID }),
    };

    await expect(
      sweepCustomerSubscriptions(gateway, CUSTOMER_ID),
    ).rejects.toThrow("list exploded");
  });

  it("surfaces partial progress when a later page fails to list", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const first = page([subscription("sub_1", "active")], true);
    const list = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("page 2 exploded"));
    const cancel = vi.fn().mockResolvedValue(subscription("sub_1", "canceled"));
    const gateway: SubscriptionGateway = {
      list,
      cancel,
      releaseSchedule: vi.fn(),
      retrieveCustomer: vi.fn().mockResolvedValue({ id: CUSTOMER_ID }),
    };

    await expect(
      sweepCustomerSubscriptions(gateway, CUSTOMER_ID),
    ).rejects.toThrow("page 2 exploded");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("partial progress"),
      expect.objectContaining({ canceledCount: 1 }),
    );
  });
});
