import { describe, expect, it, vi } from "vitest";

type SqlFragment = { strings: readonly string[]; values: unknown[] };

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

const {
  evaluateThrottleCounter,
  secondsRemainingInWindow,
  windowExpiredCondition,
} = await import("../../../server/utils/fixedWindowThrottle");

const WINDOW_SECONDS = 60;
const MAX_HITS = 30;

describe("windowExpiredCondition", () => {
  it("compares elapsed time against the window with >=, not a flipped or hardcoded comparison", () => {
    // A fake column reference is enough: this asserts the condition's shape
    // (which column, which operator, which bound), not real SQL execution.
    // Getting the operator direction wrong here would silently never expire a
    // window, letting the counter climb forever without ever resetting.
    const windowStartColumn = { name: "fake_window_start" };

    const condition = windowExpiredCondition(
      windowStartColumn as never,
      WINDOW_SECONDS,
    ) as unknown as SqlFragment;

    expect(condition.strings.join("<expr>")).toBe(
      "(now() - <expr>) >= (<expr> * interval '1 second')",
    );
    expect(condition.values).toEqual([windowStartColumn, WINDOW_SECONDS]);
  });
});

describe("evaluateThrottleCounter", () => {
  it("allows when there is no counter row (nothing to throttle)", () => {
    expect(evaluateThrottleCounter(null, MAX_HITS, WINDOW_SECONDS)).toEqual({
      allowed: true,
    });
  });

  it("allows a count under the limit", () => {
    const result = evaluateThrottleCounter(
      { count: MAX_HITS - 1, windowStart: new Date() },
      MAX_HITS,
      WINDOW_SECONDS,
    );
    expect(result).toEqual({ allowed: true });
  });

  it("allows a count exactly at the limit", () => {
    const result = evaluateThrottleCounter(
      { count: MAX_HITS, windowStart: new Date() },
      MAX_HITS,
      WINDOW_SECONDS,
    );
    expect(result).toEqual({ allowed: true });
  });

  it("denies a count over the limit and reports retryAfterSeconds", () => {
    const windowStart = new Date(Date.now() - (WINDOW_SECONDS - 10) * 1000);
    const result = evaluateThrottleCounter(
      { count: MAX_HITS + 1, windowStart },
      MAX_HITS,
      WINDOW_SECONDS,
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(11);
    }
  });
});

describe("secondsRemainingInWindow", () => {
  it("floors at 1 even if the window has already elapsed", () => {
    const windowStart = new Date(Date.now() - (WINDOW_SECONDS + 100) * 1000);
    expect(secondsRemainingInWindow(windowStart, WINDOW_SECONDS)).toBe(1);
  });

  it("reports the remaining seconds, rounded up", () => {
    const windowStart = new Date(Date.now() - (WINDOW_SECONDS - 10) * 1000);
    expect(
      secondsRemainingInWindow(windowStart, WINDOW_SECONDS),
    ).toBeLessThanOrEqual(11);
    expect(
      secondsRemainingInWindow(windowStart, WINDOW_SECONDS),
    ).toBeGreaterThan(0);
  });
});
