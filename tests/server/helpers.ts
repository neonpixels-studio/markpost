import { vi } from "vitest";
import {
  buildGithubSignatureHeader,
  buildStripeSignatureHeader,
} from "../../server/utils/signatureVerifier";

export function createMockCreateError() {
  return vi.fn((options: object) => {
    const error = new Error("createError");
    Object.assign(error, options);
    return error;
  });
}

// Delegates to the app's own signing helpers (added alongside the source
// test-event endpoint, server/api/sources/[uuid]/test.post.ts) rather than
// recomputing the HMAC here, so a test fixture can never silently drift from
// the real signing logic it's meant to exercise.
export function buildValidStripeHeader(
  rawBody: string,
  secret: string,
  timestamp?: number,
): string {
  return buildStripeSignatureHeader(rawBody, secret, timestamp);
}

export function buildValidGithubHeader(
  rawBody: string,
  secret: string,
): string {
  return buildGithubSignatureHeader(rawBody, secret);
}

export function stubFailingUpdate(updateMock: ReturnType<typeof vi.fn>): void {
  const where = vi.fn(() => Promise.reject(new Error("db error")));
  const set = vi.fn(() => ({ where }));
  updateMock.mockReturnValue({ set });
}

export function spyConsoleError(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}
