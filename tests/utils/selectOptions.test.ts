import { describe, it, expect } from "vitest";
import { normalizeSelectOptions } from "../../app/utils/selectOptions";

describe("normalizeSelectOptions", () => {
  it("wraps a bare string option into a matching value/label pair", () => {
    expect(normalizeSelectOptions(["a", "b"])).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "b" },
    ]);
  });

  it("passes through an explicit value/label option unchanged", () => {
    expect(
      normalizeSelectOptions([{ value: "monthly", label: "Monthly" }]),
    ).toEqual([{ value: "monthly", label: "Monthly" }]);
  });

  it("normalizes a mix of string and object options", () => {
    expect(
      normalizeSelectOptions(["all", { value: "err", label: "err" }]),
    ).toEqual([
      { value: "all", label: "all" },
      { value: "err", label: "err" },
    ]);
  });

  it("returns an empty array for no options", () => {
    expect(normalizeSelectOptions([])).toEqual([]);
  });
});
