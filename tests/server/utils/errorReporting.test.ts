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

  it("sends the error to Sentry, tagged by the report site", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("database exploded");

    reportError("[test] something failed", error);

    expect(captureExceptionMock).toHaveBeenCalledOnce();
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      tags: { reportSite: "[test] something failed" },
      extra: undefined,
    });
  });

  it("forwards extra context as Sentry extra data", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("database exploded");

    reportError("[test] something failed", error, { userId: "user_abc" });

    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      tags: { reportSite: "[test] something failed" },
      extra: { userId: "user_abc" },
    });
  });

  it("tags two different call sites distinctly, even when they share an underlying error", () => {
    // Sentry otherwise groups by exception type + stack alone, which would
    // collapse two unrelated best-effort failures raising the same
    // underlying DB error into a single issue.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sharedError = new Error("connection timeout");

    reportError("[hooks/ingest] failed to update source stats:", sharedError);
    reportError("[hooks/ingest] failed to write ping event:", sharedError);

    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenNthCalledWith(
      1,
      sharedError,
      expect.objectContaining({
        tags: { reportSite: "[hooks/ingest] failed to update source stats:" },
      }),
    );
    expect(captureExceptionMock).toHaveBeenNthCalledWith(
      2,
      sharedError,
      expect.objectContaining({
        tags: { reportSite: "[hooks/ingest] failed to write ping event:" },
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
      { level: "error", extra: { userId: "u1" } },
    );
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
