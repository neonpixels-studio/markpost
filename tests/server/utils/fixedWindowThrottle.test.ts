import { describe, expect, it } from "vitest";
import {
  evaluateThrottleCounter,
  secondsRemainingInWindow,
} from "../../../server/utils/fixedWindowThrottle";

const WINDOW_SECONDS = 60;
const MAX_HITS = 30;

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
