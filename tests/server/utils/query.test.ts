import { describe, expect, it } from "vitest";
import { firstQueryValue } from "../../../server/utils/query";

describe("firstQueryValue", () => {
  it("returns undefined when the value is undefined", () => {
    expect(firstQueryValue(undefined)).toBeUndefined();
  });

  it("passes through a single string value", () => {
    expect(firstQueryValue("webhook")).toBe("webhook");
  });

  it("returns the first element when given an array", () => {
    expect(firstQueryValue(["a", "b"])).toBe("a");
  });

  it("returns undefined for an empty array", () => {
    expect(firstQueryValue([])).toBeUndefined();
  });

  it("returns an empty string when the first element is empty", () => {
    expect(firstQueryValue([""])).toBe("");
  });
});
