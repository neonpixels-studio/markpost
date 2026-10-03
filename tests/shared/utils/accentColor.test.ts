import openapiTemplate from "../../../server/utils/openapi.template.json";
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

describe("openapi accentColor pattern", () => {
  it("matches HEX_COLOR_PATTERN so the docs cannot drift from the server rule", () => {
    const content = (openapiTemplate as any).paths["/settings"].put.requestBody
      .content;
    const schema = Object.values(content as Record<string, any>)[0].schema;
    const pattern =
      schema.properties.data.properties.attributes.properties.accentColor
        .pattern;

    expect(pattern).toBe(HEX_COLOR_PATTERN.source);
  });
});
