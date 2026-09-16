import { describe, it, expect } from "vitest";
import { RECORD_STATUSES, isRecordStatus } from "#shared/utils/records";

describe("isRecordStatus", () => {
  it.each(RECORD_STATUSES)("accepts each canonical status (%s)", (status) => {
    expect(isRecordStatus(status)).toBe(true);
  });

  it("rejects an unrecognized string", () => {
    expect(isRecordStatus("archived")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isRecordStatus(null)).toBe(false);
    expect(isRecordStatus(undefined)).toBe(false);
    expect(isRecordStatus(42)).toBe(false);
    expect(isRecordStatus({})).toBe(false);
  });
});
