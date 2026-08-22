import { describe, expect, it } from "vitest";
import {
  resolveTimeZone,
  startOfMonthIso,
  startOfTodayIso,
  UTC_TIME_ZONE,
} from "../../../server/utils/statsBoundaries";

describe("resolveTimeZone", () => {
  it("returns UTC when the value is undefined", () => {
    expect(resolveTimeZone(undefined)).toBe(UTC_TIME_ZONE);
  });

  it("returns UTC when the value is an empty string", () => {
    expect(resolveTimeZone("")).toBe(UTC_TIME_ZONE);
  });

  it("returns UTC when the time zone is unrecognized", () => {
    expect(resolveTimeZone("Mars/Phobos")).toBe(UTC_TIME_ZONE);
  });

  it("passes through a valid IANA time zone", () => {
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});

describe("startOfTodayIso", () => {
  it("matches naive UTC midnight for the UTC zone", () => {
    const now = new Date("2026-08-20T15:30:00.000Z");
    expect(startOfTodayIso(UTC_TIME_ZONE, now)).toBe(
      "2026-08-20T00:00:00.000Z",
    );
  });

  it("uses local midnight for a negative-offset zone near UTC midnight", () => {
    // 02:00 UTC is still 22:00 the previous day in New York (UTC-4 in summer),
    // so the local day started at 04:00 UTC on Aug 19, not Aug 20.
    const now = new Date("2026-08-20T02:00:00.000Z");
    expect(startOfTodayIso("America/New_York", now)).toBe(
      "2026-08-19T04:00:00.000Z",
    );
  });

  it("uses local midnight for a positive-offset zone near UTC midnight", () => {
    // 16:00 UTC is already 01:00 the next day in Tokyo (UTC+9), so the local
    // day started at 15:00 UTC on Aug 20, ahead of the UTC boundary.
    const now = new Date("2026-08-20T16:00:00.000Z");
    expect(startOfTodayIso("Asia/Tokyo", now)).toBe("2026-08-20T15:00:00.000Z");
  });

  it("differs from the UTC boundary for an offset zone", () => {
    const now = new Date("2026-08-20T02:00:00.000Z");
    expect(startOfTodayIso("America/New_York", now)).not.toBe(
      startOfTodayIso(UTC_TIME_ZONE, now),
    );
  });
});

describe("startOfMonthIso", () => {
  it("matches naive UTC month start for the UTC zone", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    expect(startOfMonthIso(UTC_TIME_ZONE, now)).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  it("rolls the month over at local midnight in a negative-offset zone", () => {
    // 03:00 UTC on Sep 1 is still Aug 31 in New York (UTC-4), so the month is
    // August locally and starts at Aug 1 04:00 UTC.
    const now = new Date("2026-09-01T03:00:00.000Z");
    expect(startOfMonthIso("America/New_York", now)).toBe(
      "2026-08-01T04:00:00.000Z",
    );
  });

  it("rolls the month over at local midnight in a positive-offset zone", () => {
    // 16:00 UTC on Aug 31 is already Sep 1 in Tokyo (UTC+9), so the local month
    // is September and starts at Aug 31 15:00 UTC.
    const now = new Date("2026-08-31T16:00:00.000Z");
    expect(startOfMonthIso("Asia/Tokyo", now)).toBe("2026-08-31T15:00:00.000Z");
  });
});
