import { describe, it, expect } from "vitest";
import {
  EMAIL_SOURCE_TYPE,
  isSourceTestable,
  isSourceType,
  SOURCE_TYPES,
} from "#shared/utils/sourceTypes";

describe("EMAIL_SOURCE_TYPE", () => {
  it("is a recognized source type", () => {
    expect(isSourceType(EMAIL_SOURCE_TYPE)).toBe(true);
  });

  it("matches the 'email' entry in SOURCE_TYPES", () => {
    expect(EMAIL_SOURCE_TYPE).toBe("email");
    expect(SOURCE_TYPES).toContain(EMAIL_SOURCE_TYPE);
  });
});

describe("isSourceTestable", () => {
  it("returns false for email (never ingests via the JSON webhook path)", () => {
    expect(isSourceTestable(EMAIL_SOURCE_TYPE)).toBe(false);
  });

  it.each(SOURCE_TYPES.filter((type) => type !== EMAIL_SOURCE_TYPE))(
    "returns true for %s",
    (type) => {
      expect(isSourceTestable(type)).toBe(true);
    },
  );
});
