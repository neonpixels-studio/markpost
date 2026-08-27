import { createHmac } from "node:crypto";
import { vi } from "vitest";

export function createMockCreateError() {
  return vi.fn((options: object) => {
    const error = new Error("createError");
    Object.assign(error, options);
    return error;
  });
}

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

// Unlike stubFailingUpdate (a rejected query promise), this throws
// synchronously when the update builder is entered — modelling getDb() or the
// builder chain blowing up before any promise exists.
export function stubThrowingUpdate(updateMock: ReturnType<typeof vi.fn>): void {
  updateMock.mockImplementation(() => {
    throw new Error("db error");
  });
}

export function spyConsoleError(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}
