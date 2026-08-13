import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the live-client wiring of cancelSubscriptionsForCustomer: the real
// getStripeClient/toSubscriptionGateway path, with the Stripe SDK itself mocked
// so no network call happens. Guards the method mapping (list/cancel) and the
// error sanitization that keeps raw Stripe errors off the wire.

const listMock = vi.fn();
const cancelMock = vi.fn();
const retrieveCustomerMock = vi.fn();
const releaseScheduleMock = vi.fn();
const listSchedulesMock = vi.fn();
const cancelScheduleMock = vi.fn();
const retrieveScheduleMock = vi.fn();

// StripeErrorStub carries a `code` so the wrong-key retrieve test can raise a
// real resource_missing through isResourceMissingError. Errors here extend it,
// so the service's classifiers (isAlreadyCanceledError /
// isScheduleManagedCancelError) also run against them; keep stub messages
// aligned with the real Stripe wording so a stub tweak can't silently change
// which branch a test exercises.
class StripeErrorStub extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

class StripeInvalidRequestErrorStub extends StripeErrorStub {
  rawType = "invalid_request_error";
}

vi.mock("stripe", () => {
  class StripeStub {
    subscriptions = { list: listMock, cancel: cancelMock };
    customers = { retrieve: retrieveCustomerMock };
    subscriptionSchedules = {
      release: releaseScheduleMock,
      list: listSchedulesMock,
      cancel: cancelScheduleMock,
      retrieve: retrieveScheduleMock,
    };
    static errors = {
      StripeError: StripeErrorStub,
      StripeInvalidRequestError: StripeInvalidRequestErrorStub,
    };
  }
  return { default: StripeStub };
});

const { cancelSubscriptionsForCustomer } =
  await import("../../../server/services/stripe");

const CUSTOMER_ID = "cus_live123";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  // The sweep proves key visibility first; default it to a visible customer so
  // each test opts into the wrong-key path explicitly.
  retrieveCustomerMock.mockResolvedValue({
    id: CUSTOMER_ID,
    object: "customer",
  });
  // Default to no schedules so the subscription-focused tests exercise the
  // schedule pass as a no-op; the schedule test opts in explicitly.
  listSchedulesMock.mockResolvedValue({ data: [], has_more: false });
  cancelScheduleMock.mockResolvedValue({ id: "sub_sched", status: "canceled" });
  // Default the re-read to a still-pending schedule so a refused cancel fails
  // loud unless a test opts into the tolerance path explicitly.
  retrieveScheduleMock.mockResolvedValue({
    id: "sub_sched",
    status: "not_started",
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cancelSubscriptionsForCustomer (live wiring)", () => {
  it("maps the sweep onto stripe.subscriptions.list and .cancel", async () => {
    listMock.mockResolvedValue({
      data: [{ id: "sub_live", status: "active" }],
      has_more: false,
    });
    cancelMock.mockResolvedValue({ id: "sub_live", status: "canceled" });

    const result = await cancelSubscriptionsForCustomer(CUSTOMER_ID);

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: CUSTOMER_ID, status: "all" }),
    );
    // A returned subscription proves visibility, so no customer retrieve.
    expect(retrieveCustomerMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith("sub_live");
    expect(result.canceledCount).toBe(1);
  });

  it("fails loud, sanitized, when the key cannot see the customer", async () => {
    // An empty sweep under a wrong test/live or rotated key: the customer
    // retrieve returns resource_missing, so the sweep must refuse rather than
    // let a still-billing account be deleted, and must not leak the raw Stripe
    // error (no statusCode on the wire).
    listMock.mockResolvedValue({ data: [], has_more: false });
    retrieveCustomerMock.mockRejectedValueOnce(
      new StripeErrorStub(
        "No such customer: 'cus_live123'",
        "resource_missing",
      ),
    );

    const error = await cancelSubscriptionsForCustomer(CUSTOMER_ID).catch(
      (caught: unknown) => caught,
    );

    expect(listMock).toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
    expect((error as Error).message).toBe("Stripe subscription sweep failed");
    expect((error as { statusCode?: number }).statusCode).toBeUndefined();
  });

  it("sanitizes a Stripe failure so no statusCode-bearing error escapes", async () => {
    const leaky = Object.assign(new Error("No such customer: 'cus_live123'"), {
      statusCode: 404,
    });
    listMock.mockRejectedValue(leaky);

    const error = await cancelSubscriptionsForCustomer(CUSTOMER_ID).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Stripe subscription sweep failed");
    expect((error as { statusCode?: number }).statusCode).toBeUndefined();
  });

  it("maps the schedule release onto stripe.subscriptionSchedules.release", async () => {
    listMock.mockResolvedValue({
      data: [{ id: "sub_live", status: "active", schedule: "sub_sched_live" }],
      has_more: false,
    });
    cancelMock.mockRejectedValueOnce(
      new StripeInvalidRequestErrorStub(
        "This subscription is managed by a schedule and cannot be canceled",
      ),
    );
    cancelMock.mockResolvedValueOnce({ id: "sub_live", status: "canceled" });
    releaseScheduleMock.mockResolvedValue({ id: "sub_sched_live" });

    const result = await cancelSubscriptionsForCustomer(CUSTOMER_ID);

    expect(releaseScheduleMock).toHaveBeenCalledWith("sub_sched_live");
    expect(cancelMock).toHaveBeenCalledTimes(2);
    expect(result.canceledCount).toBe(1);
  });

  it("maps the schedule sweep onto stripe.subscriptionSchedules.list and .cancel", async () => {
    // A not_started schedule carries no subscription, so subscriptions.list is
    // empty; the schedule sweep must still find and cancel it.
    listMock.mockResolvedValue({ data: [], has_more: false });
    listSchedulesMock.mockResolvedValue({
      data: [{ id: "sub_sched_pending", status: "not_started" }],
      has_more: false,
    });

    const result = await cancelSubscriptionsForCustomer(CUSTOMER_ID);

    expect(listSchedulesMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: CUSTOMER_ID }),
    );
    expect(cancelScheduleMock).toHaveBeenCalledWith("sub_sched_pending");
    expect(result.canceledScheduleCount).toBe(1);
  });

  it("sweeps schedules before subscriptions to close the activation window", async () => {
    // A not_started schedule that activates between the two passes is left with a
    // live subscription the later subscription pass catches — but only if
    // schedules run first. Pin the order so a swap can't silently reopen the gap.
    listMock.mockResolvedValue({ data: [], has_more: false });
    listSchedulesMock.mockResolvedValue({ data: [], has_more: false });

    await cancelSubscriptionsForCustomer(CUSTOMER_ID);

    expect(listSchedulesMock.mock.invocationCallOrder[0]).toBeLessThan(
      listMock.mock.invocationCallOrder[0],
    );
  });

  it("fails loud, sanitized, when a schedule cancel fails", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    listMock.mockResolvedValue({ data: [], has_more: false });
    listSchedulesMock.mockResolvedValue({
      data: [{ id: "sub_sched_pending", status: "not_started" }],
      has_more: false,
    });
    cancelScheduleMock.mockRejectedValueOnce(new Error("schedule cancel boom"));

    const error = await cancelSubscriptionsForCustomer(CUSTOMER_ID).catch(
      (caught: unknown) => caught,
    );

    expect((error as Error).message).toBe("Stripe subscription sweep failed");
    expect((error as { statusCode?: number }).statusCode).toBeUndefined();
    // The failed schedule id must reach the "sweep incomplete" audit log.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("sweep incomplete"),
      expect.objectContaining({ failedScheduleIds: ["sub_sched_pending"] }),
    );
  });

  it("attempts every subscription then fails loud when one cancel fails", async () => {
    listMock.mockResolvedValue({
      data: [
        { id: "sub_bad", status: "active" },
        { id: "sub_good", status: "active" },
      ],
      has_more: false,
    });
    cancelMock.mockRejectedValueOnce(new Error("cancel boom"));
    cancelMock.mockResolvedValueOnce({ id: "sub_good", status: "canceled" });

    const error = await cancelSubscriptionsForCustomer(CUSTOMER_ID).catch(
      (caught: unknown) => caught,
    );

    expect(cancelMock).toHaveBeenCalledWith("sub_good");
    expect((error as Error).message).toBe("Stripe subscription sweep failed");
  });

  it("fails loud as a wrong key when listing schedules can't see the customer", async () => {
    // Schedules list first, so a key that can't see the customer surfaces here as
    // resource_missing and must be classified as the wrong-key blind spot.
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    listSchedulesMock.mockRejectedValueOnce(
      new StripeErrorStub(
        "No such customer: 'cus_live123'",
        "resource_missing",
      ),
    );

    const error = await cancelSubscriptionsForCustomer(CUSTOMER_ID).catch(
      (caught: unknown) => caught,
    );

    expect((error as Error).message).toBe("Stripe subscription sweep failed");
    expect(listMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("key cannot see customer"),
      expect.objectContaining({ customerId: CUSTOMER_ID }),
    );
  });

  it("still cancels subscriptions when the schedule pass fails for a non-wrong-key reason", async () => {
    // A transient schedule-list failure (or a key lacking schedule access) must
    // not skip the subscription pass — that would leave live subscriptions
    // billing a deleted account. Subscriptions are canceled; the run still fails
    // loud on the schedule error.
    listSchedulesMock.mockRejectedValueOnce(
      new Error("schedule list exploded"),
    );
    listMock.mockResolvedValue({
      data: [{ id: "sub_live", status: "active" }],
      has_more: false,
    });
    cancelMock.mockResolvedValue({ id: "sub_live", status: "canceled" });

    const error = await cancelSubscriptionsForCustomer(CUSTOMER_ID).catch(
      (caught: unknown) => caught,
    );

    expect(cancelMock).toHaveBeenCalledWith("sub_live");
    expect((error as Error).message).toBe("Stripe subscription sweep failed");
  });

  it("surfaces subscription-pass failures when the schedule pass also failed", async () => {
    // Schedule pass fails (non-wrong-key) and the subscription pass records a
    // failed cancel without throwing. Rethrowing the schedule error skips the
    // top-level "sweep incomplete" log, so the failed subscription id must be
    // surfaced here or an operator never learns it's still billing.
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    listSchedulesMock.mockRejectedValueOnce(
      new Error("schedule list exploded"),
    );
    listMock.mockResolvedValue({
      data: [{ id: "sub_live", status: "active" }],
      has_more: false,
    });
    cancelMock.mockRejectedValueOnce(new Error("cancel boom"));

    await cancelSubscriptionsForCustomer(CUSTOMER_ID).catch(() => undefined);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("subscription progress"),
      expect.objectContaining({ failedSubscriptionIds: ["sub_live"] }),
    );
  });

  it("logs schedule progress when the subscription pass fails after schedules ran", async () => {
    // The schedule pass canceled a pending schedule; the later subscription pass
    // then throws. The already-canceled schedule must be surfaced, not lost.
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    listSchedulesMock.mockResolvedValue({
      data: [{ id: "sub_sched_pending", status: "not_started" }],
      has_more: false,
    });
    listMock.mockRejectedValueOnce(new Error("subscription list exploded"));

    await cancelSubscriptionsForCustomer(CUSTOMER_ID).catch(() => undefined);

    expect(cancelScheduleMock).toHaveBeenCalledWith("sub_sched_pending");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("schedule progress"),
      expect.objectContaining({ canceledScheduleCount: 1 }),
    );
  });

  it("does not log schedule progress when the schedule pass touched nothing", async () => {
    // Guard: with no schedules to cancel, a subscription-pass failure must not
    // emit the schedule-progress line.
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    listSchedulesMock.mockResolvedValue({ data: [], has_more: false });
    listMock.mockRejectedValueOnce(new Error("subscription list exploded"));

    await cancelSubscriptionsForCustomer(CUSTOMER_ID).catch(() => undefined);

    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("schedule progress"),
      expect.anything(),
    );
  });
});
