import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the underlying Svix-based verifier so no live @clerk/backend call runs.
const mockVerifyWebhook = vi.fn();

vi.mock("@clerk/backend/webhooks", () => ({
  verifyWebhook: (...args: unknown[]) => mockVerifyWebhook(...args),
}));

const { verifyClerkWebhookEvent, getClerkWebhookSigningSecret } =
  await import("../../../server/services/clerkWebhook");

const SIGNING_SECRET = "whsec_test_clerk";
const RAW_BODY = '{"type":"user.deleted","data":{"id":"user_1"}}';
const HEADERS = {
  "svix-id": "msg_1",
  "svix-timestamp": "1700000000",
  "svix-signature": "v1,sig",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;
});

afterEach(() => {
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
});

describe("getClerkWebhookSigningSecret", () => {
  it("returns the configured secret", () => {
    expect(getClerkWebhookSigningSecret()).toBe(SIGNING_SECRET);
  });

  it("throws a 503 ApiError when the secret is not configured", () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    expect(() => getClerkWebhookSigningSecret()).toThrow(
      expect.objectContaining({ statusCode: 503 }),
    );
  });
});

describe("verifyClerkWebhookEvent", () => {
  it("passes the signing secret and a Svix-headed request to the verifier", async () => {
    mockVerifyWebhook.mockResolvedValue({ type: "user.deleted" });

    await verifyClerkWebhookEvent(RAW_BODY, HEADERS, SIGNING_SECRET);

    const [request, options] = mockVerifyWebhook.mock.calls[0];
    expect(options).toEqual({ signingSecret: SIGNING_SECRET });
    expect(request).toBeInstanceOf(Request);
    expect(request.headers.get("svix-id")).toBe(HEADERS["svix-id"]);
    expect(request.headers.get("svix-signature")).toBe(
      HEADERS["svix-signature"],
    );
    await expect(request.text()).resolves.toBe(RAW_BODY);
  });

  it("omits absent Svix headers rather than fabricating placeholders", async () => {
    mockVerifyWebhook.mockRejectedValue(new Error("no signature"));

    await expect(
      verifyClerkWebhookEvent(RAW_BODY, {}, SIGNING_SECRET),
    ).rejects.toThrow("no signature");

    const [request] = mockVerifyWebhook.mock.calls[0];
    expect(request.headers.get("svix-signature")).toBeNull();
    expect(request.headers.get("svix-id")).toBeNull();
  });

  it("propagates a verification failure from the verifier", async () => {
    mockVerifyWebhook.mockRejectedValue(new Error("invalid signature"));

    await expect(
      verifyClerkWebhookEvent(RAW_BODY, HEADERS, SIGNING_SECRET),
    ).rejects.toThrow("invalid signature");
  });

  it("returns the verified event unchanged", async () => {
    const event = { type: "user.deleted", data: { id: "user_1" } };
    mockVerifyWebhook.mockResolvedValue(event);

    await expect(
      verifyClerkWebhookEvent(RAW_BODY, HEADERS, SIGNING_SECRET),
    ).resolves.toBe(event);
  });
});
