import { describe, expect, it } from "vitest";
import { HEX_COLOR_PATTERN } from "../../../shared/utils/accentColor";

describe("HEX_COLOR_PATTERN", () => {
  it.each(["#a855f7", "#A855F7", "#000000"])("accepts %s", (value) => {
    expect(HEX_COLOR_PATTERN.test(value)).toBe(true);
  });

  it.each(["a855f7", "#fff", "#a855f7a", "#gggggg", "red", "", "#a855f7\n"])(
    "rejects %j",
    (value) => {
      expect(HEX_COLOR_PATTERN.test(value)).toBe(false);
    },
  );
});
