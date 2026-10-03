import { describe, it, expect } from "vitest";
import {
  EMAIL_SOURCE_TYPE,
  isSourcePausable,
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

describe("isSourcePausable", () => {
  it("is false for email, which has no inbound handler to enforce a pause", () => {
    expect(isSourcePausable(EMAIL_SOURCE_TYPE)).toBe(false);
  });

  it.each(SOURCE_TYPES.filter((type) => type !== EMAIL_SOURCE_TYPE))(
    "is true for %s",
    (type) => {
      expect(isSourcePausable(type)).toBe(true);
    },
  );
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
