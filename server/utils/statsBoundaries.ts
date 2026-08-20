// Day/month boundaries for the inbox stats endpoint, computed in the requester's
// IANA time zone rather than UTC so "synced today" and "this month" roll over at
// the user's local midnight (issue #205). Boundaries are returned as UTC ISO
// strings because that is what `records.syncedAt` / `records.createdAt` are
// compared against in the query.
//
// This is display-only. Plan-limit enforcement and the billing usage dashboard
// deliberately keep a shared UTC month boundary (server/utils/recordUsage.ts)
// so the enforced cap and the displayed usage can never disagree; that path is
// intentionally not routed through here.

export const UTC_TIME_ZONE = "UTC";

type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

// Validate an IANA time zone, falling back to UTC when it is missing or
// unrecognized. Intl throws a RangeError on an unsupported `timeZone`, which is
// the cheapest reliable way to check support without shipping a zone database.
export function resolveTimeZone(rawTimeZone: string | undefined): string {
  if (!rawTimeZone) {
    return UTC_TIME_ZONE;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: rawTimeZone });
    return rawTimeZone;
  } catch {
    return UTC_TIME_ZONE;
  }
}

function wallClockInTimeZone(instant: Date, timeZone: string): WallClock {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(instant);
  const lookup = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return Number(part?.value);
  };

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: lookup("hour"),
    minute: lookup("minute"),
    second: lookup("second"),
  };
}

// Offset in milliseconds between the time zone's wall clock and UTC at `instant`
// (e.g. -4h for America/New_York during DST). Derived by reading the wall clock
// and reinterpreting it as UTC, so it needs no external offset table.
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const wall = wallClockInTimeZone(instant, timeZone);
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );

  // formatToParts carries no millisecond field, so compare against the instant
  // truncated to whole seconds to keep the difference a clean offset.
  const instantSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return wallAsUtc - instantSeconds;
}

// UTC instant for local midnight of the given wall-clock date in `timeZone`.
// The offset is sampled once at the naive UTC instant; across a DST transition
// that lands exactly at midnight this can be off by the transition amount, but
// clock changes almost never occur at 00:00, so a single correction is accurate
// in practice.
function localMidnightUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = timeZoneOffsetMs(new Date(naiveUtc), timeZone);
  return new Date(naiveUtc - offset);
}

// Start of the current local day, as a UTC ISO string.
export function startOfTodayIso(
  timeZone: string,
  now: Date = new Date(),
): string {
  const wall = wallClockInTimeZone(now, timeZone);
  return localMidnightUtc(
    wall.year,
    wall.month,
    wall.day,
    timeZone,
  ).toISOString();
}

// Start of the current local month, as a UTC ISO string.
export function startOfMonthIso(
  timeZone: string,
  now: Date = new Date(),
): string {
  const wall = wallClockInTimeZone(now, timeZone);
  return localMidnightUtc(wall.year, wall.month, 1, timeZone).toISOString();
}
