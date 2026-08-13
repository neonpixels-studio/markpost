import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the live-client wiring of cancelSubscriptionsForCustomer: the real
// getStripeClient/toSubscriptionGateway path, with the Stripe SDK itself mocked
// so no network call happens. Guards the method mapping (list/cancel) and the
// error sanitization that keeps raw Stripe errors off the wire.

const listMock = vi.fn();
const cancelMock = vi.fn();
const retrieveCustomerMock = vi.fn();
const releaseScheduleMock = vi.fn();

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
    subscriptionSchedules = { release: releaseScheduleMock };
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
});
