import { describe, it, expect } from "vitest";
import {
  EVENT_RETENTION_DAYS,
  RETENTION_NOTICE_TITLE,
  retentionNoticeMessage,
} from "#shared/utils/retention";

describe("retentionNoticeMessage", () => {
  it("quotes the retention window in the copy", () => {
    expect(retentionNoticeMessage()).toContain(`${EVENT_RETENTION_DAYS} days`);
  });

  it("derives the day count from the passed value so copy can't drift", () => {
    expect(retentionNoticeMessage(30)).toContain("30 days");
    expect(retentionNoticeMessage(30)).not.toContain(
      `${EVENT_RETENTION_DAYS} days`,
    );
  });

  it("tells the user to export to keep a copy", () => {
    expect(retentionNoticeMessage()).toContain("Export your log");
  });
});

describe("retention notice constants", () => {
  it("keeps the retention window at 90 days", () => {
    expect(EVENT_RETENTION_DAYS).toBe(90);
  });

  it("titles the notice with the retention window", () => {
    expect(RETENTION_NOTICE_TITLE).toBe("90-day retention");
  });
});
