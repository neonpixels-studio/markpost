import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { H3Event } from "h3";
import { createMockCreateError } from "../../helpers";

// ── Service mocks: isolate Svix verification and the shared teardown ────────

const mockVerifyClerkWebhookEvent = vi.fn();
const mockGetClerkWebhookSigningSecret = vi.fn();

vi.mock("../../../../server/services/clerkWebhook", () => ({
  verifyClerkWebhookEvent: (...args: unknown[]) =>
    mockVerifyClerkWebhookEvent(...args),
  getClerkWebhookSigningSecret: (...args: unknown[]) =>
    mockGetClerkWebhookSigningSecret(...args),
  SVIX_ID_HEADER: "svix-id",
}));

const mockReconcileAccountDeletion = vi.fn();

vi.mock("../../../../server/services/accountDeletion", () => ({
  reconcileAccountDeletion: (...args: unknown[]) =>
    mockReconcileAccountDeletion(...args),
}));

// ── H3 globals ──────────────────────────────────────────────────────────────

const mockCreateError = createMockCreateError();
const mockReadRawBody = vi.fn();
const mockGetHeaders = vi.fn();

vi.stubGlobal("defineEventHandler", (fn: unknown) => fn);

// ── Import AFTER mocks ──────────────────────────────────────────────────────

const handler = (await import("../../../../server/api/webhooks/clerk.post"))
  .default;

const RAW_BODY = '{"type":"user.deleted","data":{"id":"user_deleted_1"}}';
const SVIX_HEADERS = {
  "svix-id": "msg_1",
  "svix-timestamp": "1700000000",
  "svix-signature": "v1,valid",
};

function buildEvent(): H3Event {
  return { context: {} } as unknown as H3Event;
}

beforeEach(() => {
  vi.stubGlobal("createError", mockCreateError);
  vi.stubGlobal("readRawBody", mockReadRawBody);
  vi.stubGlobal("getHeaders", mockGetHeaders);

  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  mockCreateError.mockImplementation((options: object) => {
    const error = new Error("createError");
    Object.assign(error, options);
    return error;
  });
  mockReadRawBody.mockResolvedValue(RAW_BODY);
  mockGetHeaders.mockReturnValue(SVIX_HEADERS);
  mockGetClerkWebhookSigningSecret.mockReturnValue("whsec_test");
  mockReconcileAccountDeletion.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/clerk", () => {
  it("reconciles the account (cancel + wipe) on a verified user.deleted event", async () => {
    mockVerifyClerkWebhookEvent.mockResolvedValue({
      type: "user.deleted",
      data: { id: "user_deleted_1" },
    });

    const result = await handler(buildEvent());

    expect(mockReconcileAccountDeletion).toHaveBeenCalledWith(
      "user_deleted_1",
      {
        deleteClerkIdentity: false,
      },
    );
    expect(result).toEqual({ data: { received: true } });
  });

  it("verifies the Svix signature against the raw body and headers", async () => {
    mockVerifyClerkWebhookEvent.mockResolvedValue({
      type: "user.deleted",
      data: { id: "user_deleted_1" },
    });

    await handler(buildEvent());

    expect(mockVerifyClerkWebhookEvent).toHaveBeenCalledWith(
      RAW_BODY,
      SVIX_HEADERS,
      "whsec_test",
    );
  });

  it("propagates a 503 (not 400) and runs no verification when the secret is unconfigured", async () => {
    const configError = Object.assign(new Error("createError"), {
      statusCode: 503,
    });
    mockGetClerkWebhookSigningSecret.mockImplementation(() => {
      throw configError;
    });

    await expect(handler(buildEvent())).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(mockVerifyClerkWebhookEvent).not.toHaveBeenCalled();
    expect(mockReconcileAccountDeletion).not.toHaveBeenCalled();
  });

  it("returns 400 and runs no teardown when signature verification fails", async () => {
    mockVerifyClerkWebhookEvent.mockRejectedValue(
      new Error("invalid signature"),
    );

    await expect(handler(buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockReconcileAccountDeletion).not.toHaveBeenCalled();
    expect(mockCreateError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it("ignores an unknown event type with a 200 no-op", async () => {
    mockVerifyClerkWebhookEvent.mockResolvedValue({
      type: "user.updated",
      data: { id: "user_deleted_1" },
    });

    const result = await handler(buildEvent());

    expect(mockReconcileAccountDeletion).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { received: true } });
  });

  it("skips reconciliation and logs the delivery id when user.deleted carries no user id", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockVerifyClerkWebhookEvent.mockResolvedValue({
      type: "user.deleted",
      data: {},
    });

    const result = await handler(buildEvent());

    expect(mockReconcileAccountDeletion).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing user id"),
      expect.objectContaining({ svixId: SVIX_HEADERS["svix-id"] }),
    );
    expect(result).toEqual({ data: { received: true } });
  });

  it("propagates a 503 when reconciliation fails so Svix retries the delivery", async () => {
    mockVerifyClerkWebhookEvent.mockResolvedValue({
      type: "user.deleted",
      data: { id: "user_deleted_1" },
    });
    const reconcileError = Object.assign(new Error("createError"), {
      statusCode: 503,
    });
    mockReconcileAccountDeletion.mockRejectedValue(reconcileError);

    await expect(handler(buildEvent())).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("passes an empty string to the verifier when the body is absent", async () => {
    mockReadRawBody.mockResolvedValue(undefined);
    mockVerifyClerkWebhookEvent.mockRejectedValue(new Error("invalid"));

    await expect(handler(buildEvent())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockVerifyClerkWebhookEvent).toHaveBeenCalledWith(
      "",
      SVIX_HEADERS,
      "whsec_test",
    );
  });
});
