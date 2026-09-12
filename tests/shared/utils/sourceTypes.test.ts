import { describe, it, expect } from "vitest";
import {
  EMAIL_SOURCE_TYPE,
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
