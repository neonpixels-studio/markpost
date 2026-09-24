import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "../../../server/utils/errorReporting";

const captureExceptionMock = vi.fn();

vi.mock("@sentry/nuxt", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

describe("reportError", () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the message and error to the console", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("database exploded");

    reportError("[test] something failed", error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[test] something failed",
      error,
    );
  });

  it("sends the error to Sentry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("database exploded");

    reportError("[test] something failed", error);

    expect(captureExceptionMock).toHaveBeenCalledOnce();
    expect(captureExceptionMock).toHaveBeenCalledWith(error, undefined);
  });

  it("forwards extra context as Sentry extra data", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("database exploded");

    reportError("[test] something failed", error, { userId: "user_abc" });

    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      extra: { userId: "user_abc" },
    });
  });

  it("reports a non-Error thrown value", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportError("[test] something failed", "a plain string error");

    expect(captureExceptionMock).toHaveBeenCalledWith(
      "a plain string error",
      undefined,
    );
  });

  it("does not report the same error object to Sentry twice", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("database exploded");

    reportError("[funnel] unexpected error", error);
    reportError("[inner] failed to write event", error);

    // The inner, more specific catch site reported first — the funnel's later
    // catch of the same error object must not produce a second Sentry event.
    expect(captureExceptionMock).toHaveBeenCalledOnce();
    // Both call sites still get their own console.error line — only the
    // Sentry side is deduplicated.
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("reports two distinct error instances separately, even with the same message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportError("[test] something failed", new Error("boom"));
    reportError("[test] something failed", new Error("boom"));

    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
  });
});
