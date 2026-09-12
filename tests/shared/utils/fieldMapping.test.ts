import { describe, it, expect } from "vitest";
import {
  FIELD_MAPPING_FORBIDDEN_SEGMENTS,
  FIELD_MAPPING_KEYS,
  FIELD_MAPPING_PATH_MAX_LENGTH,
  isFieldMappingConfig,
  isSourceMappable,
  isValidFieldMappingPath,
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

describe("isValidFieldMappingPath", () => {
  it.each(["title", "data.subject", "a.b.c", "data_1.sub-field"])(
    "accepts %s",
    (path) => {
      expect(isValidFieldMappingPath(path)).toBe(true);
    },
  );

  it.each(["", ".", ".data", "data.", "data..subject", ".."])(
    "rejects %s (empty segment)",
    (path) => {
      expect(isValidFieldMappingPath(path)).toBe(false);
    },
  );

  it.each([...FIELD_MAPPING_FORBIDDEN_SEGMENTS])(
    "rejects a path containing the forbidden segment %s",
    (segment) => {
      expect(isValidFieldMappingPath(`data.${segment}.value`)).toBe(false);
      expect(isValidFieldMappingPath(segment)).toBe(false);
    },
  );

  it("accepts a path at exactly the max length", () => {
    expect(
      isValidFieldMappingPath("a".repeat(FIELD_MAPPING_PATH_MAX_LENGTH)),
    ).toBe(true);
  });

  it("rejects a path exceeding the max length", () => {
    expect(
      isValidFieldMappingPath("a".repeat(FIELD_MAPPING_PATH_MAX_LENGTH + 1)),
    ).toBe(false);
  });

  it.each(["items[0]", "data.items[0].name", "[0]"])(
    "rejects bracket array syntax %s (getNestedValue has no bracket support)",
    (path) => {
      expect(isValidFieldMappingPath(path)).toBe(false);
    },
  );

  it("accepts a numeric segment as the array-index equivalent", () => {
    expect(isValidFieldMappingPath("data.items.0.name")).toBe(true);
  });

  it("rejects a whitespace-only segment", () => {
    expect(isValidFieldMappingPath("data. .subject")).toBe(false);
  });
});

describe("isSourceMappable", () => {
  it("is always mappable for a non-email source type, regardless of fieldMapping", () => {
    expect(isSourceMappable("webhook", null)).toBe(true);
    expect(isSourceMappable("webhook", undefined)).toBe(true);
    expect(isSourceMappable("stripe", { title: "x" })).toBe(true);
  });

  it("is not mappable for an email source with no stored mapping", () => {
    expect(isSourceMappable("email", null)).toBe(false);
  });

  it("is not mappable for an email source whose fieldMapping is undefined", () => {
    // fieldMapping is typed `unknown` throughout the client (see
    // app/composables/useSources.ts) — undefined is type-legal, and must not
    // be treated as "has a mapping".
    expect(isSourceMappable("email", undefined)).toBe(false);
  });

  it("is not mappable for an email source with a non-conforming stored value", () => {
    expect(isSourceMappable("email", { event: "$.type" })).toBe(false);
  });

  it("is not mappable for an email source whose mapping has every field blank", () => {
    expect(isSourceMappable("email", { title: "   " })).toBe(false);
  });

  it("is mappable for an email source with a genuinely populated mapping", () => {
    expect(isSourceMappable("email", { title: "subject" })).toBe(true);
  });
});
