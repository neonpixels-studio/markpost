import { describe, it, expect } from "vitest";
import {
  FIELD_MAPPING_KEYS,
  isFieldMappingConfig,
} from "#shared/utils/fieldMapping";

describe("FIELD_MAPPING_KEYS", () => {
  it("lists every recognized mapping key", () => {
    expect(FIELD_MAPPING_KEYS).toEqual([
      "title",
      "content",
      "html",
      "source",
      "tags",
      "created",
    ]);
  });
});

describe("isFieldMappingConfig", () => {
  it("accepts an empty object", () => {
    expect(isFieldMappingConfig({})).toBe(true);
  });

  it("accepts an object with only recognized string keys", () => {
    expect(
      isFieldMappingConfig({ title: "data.subject", tags: "data.labels" }),
    ).toBe(true);
  });

  it("rejects a value with a non-string recognized key", () => {
    expect(isFieldMappingConfig({ title: 123 })).toBe(false);
  });

  it("accepts unrecognized keys alongside valid ones (forward-compatible passthrough)", () => {
    expect(isFieldMappingConfig({ title: "subject", extra: "ignored" })).toBe(
      true,
    );
  });

  it("rejects null", () => {
    expect(isFieldMappingConfig(null)).toBe(false);
  });

  it("rejects an array", () => {
    expect(isFieldMappingConfig(["title"])).toBe(false);
  });

  it("rejects a primitive", () => {
    expect(isFieldMappingConfig("title")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isFieldMappingConfig(undefined)).toBe(false);
  });
});
