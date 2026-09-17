import { createHmac } from "node:crypto";
import { vi } from "vitest";

export function createMockCreateError() {
  return vi.fn((options: object) => {
    const error = new Error("createError");
    Object.assign(error, options);
    return error;
  });
}

// Deliberately NOT delegated to signatureVerifier.ts's own
// buildStripeSignatureHeader/buildGithubSignatureHeader (added alongside the
// source test-event endpoint, server/api/sources/[uuid]/test.post.ts): those
// share their HMAC computation with verifyStripeSignature/verifyGithubSignature
// (the functions signatureVerifier.test.ts exercises), so a fixture built from
// them would sign and verify with the same code — a regression that could
// silently break real verification (e.g. a wrong delimiter or hash algorithm)
// while every test using this fixture stayed green. This stays an independent
// transcription of each provider's published signing scheme.
export function buildValidStripeHeader(
  rawBody: string,
  secret: string,
  timestamp?: number,
): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${rawBody}`;
  const sig = createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");
  return `t=${ts},v1=${sig}`;
}

export function buildValidGithubHeader(
  rawBody: string,
  secret: string,
): string {
  const sig = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  return `sha256=${sig}`;
}

export function stubFailingUpdate(updateMock: ReturnType<typeof vi.fn>): void {
  const where = vi.fn(() => Promise.reject(new Error("db error")));
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
}

export function spyConsoleError(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}
