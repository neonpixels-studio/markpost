import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportError,
  reportErrorCondition,
} from "../../../server/utils/errorReporting";

const captureExceptionMock = vi.fn();
const captureMessageMock = vi.fn();

vi.mock("@sentry/nuxt", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

describe("reportError", () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    captureMessageMock.mockClear();
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

  it("sends the error to Sentry, tagged and fingerprinted by the report site", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("database exploded");

    reportError("[test] something failed", error);

    expect(captureExceptionMock).toHaveBeenCalledOnce();
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      tags: { reportSite: "[test] something failed" },
      fingerprint: ["{{ default }}", "[test] something failed"],
      extra: undefined,
    });
  });

  it("forwards extra context as Sentry extra data", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("database exploded");

    reportError("[test] something failed", error, { userId: "user_abc" });

    expect(captureExceptionMock).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ extra: { userId: "user_abc" } }),
    );
  });

  it("fingerprints two different call sites distinctly, even when they share an underlying error", () => {
    // Sentry groups by exception type + stack trace by default, which would
    // otherwise collapse two unrelated best-effort failures raising the same
    // underlying DB error into a single issue — the fingerprint (not the tag)
    // is what actually keeps them apart.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sharedError = new Error("connection timeout");

    reportError("[hooks/ingest] failed to update source stats:", sharedError);
    reportError("[hooks/ingest] failed to write ping event:", sharedError);

    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenNthCalledWith(
      1,
      sharedError,
      expect.objectContaining({
        fingerprint: [
          "{{ default }}",
          "[hooks/ingest] failed to update source stats:",
        ],
      }),
    );
    expect(captureExceptionMock).toHaveBeenNthCalledWith(
      2,
      sharedError,
      expect.objectContaining({
        fingerprint: [
          "{{ default }}",
          "[hooks/ingest] failed to write ping event:",
        ],
      }),
    );
  });

  it("reports a non-Error thrown value", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportError("[test] something failed", "a plain string error");

    expect(captureExceptionMock).toHaveBeenCalledWith(
      "a plain string error",
      expect.objectContaining({
        tags: { reportSite: "[test] something failed" },
      }),
    );
  });

  it("never throws when the Sentry SDK call itself fails", () => {
    // Every call site wraps a best-effort operation specifically so a
    // reporting failure can't turn a handled/swallowed error into an
    // unhandled one — see the comment on captureSafely in errorReporting.ts.
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    captureExceptionMock.mockImplementation(() => {
      throw new Error("Sentry SDK not initialized");
    });

    expect(() =>
      reportError("[test] something failed", new Error("boom")),
    ).not.toThrow();

    // Both the original failure and the reporting failure are still logged.
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
  });
});

describe("reportErrorCondition", () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    captureMessageMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the message and context to the console", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    reportErrorCondition("[test] missing required field", { userId: "u1" });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[test] missing required field",
      { userId: "u1" },
    );
  });

  it("sends a Sentry message event carrying the context, for a condition with no thrown exception", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportErrorCondition("[test] missing required field", { userId: "u1" });

    expect(captureMessageMock).toHaveBeenCalledWith(
      "[test] missing required field",
      {
        level: "error",
        fingerprint: ["{{ default }}", "[test] missing required field"],
        extra: { userId: "u1" },
      },
    );
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("never throws when the Sentry SDK call itself fails", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    captureMessageMock.mockImplementation(() => {
      throw new Error("Sentry SDK not initialized");
    });

    expect(() =>
      reportErrorCondition("[test] missing required field"),
    ).not.toThrow();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
  });
});
