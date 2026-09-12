import { describe, it, expect } from "vitest";
import { FIELD_MAPPING_KEYS } from "#shared/utils/fieldMapping";
import {
  BLANKABLE_FIELD_MAPPING_FIELDS,
  FIELD_MAPPING_FIELDS,
  fieldMappingToFormValues,
  formValuesToFieldMapping,
  invalidFieldMappingFields,
} from "../../app/utils/fieldMappingForm";

describe("FIELD_MAPPING_FIELDS", () => {
  it("has exactly one entry per key in FIELD_MAPPING_KEYS, in order", () => {
    // Asserted against the shared source of truth (not a hardcoded literal)
    // so a key added to FIELD_MAPPING_KEYS without a matching entry here
    // fails this test rather than silently rendering no input for it.
    expect(FIELD_MAPPING_FIELDS.map((field) => field.key)).toEqual([
      ...FIELD_MAPPING_KEYS,
    ]);
  });

  it("gives every field a non-empty label and hint", () => {
    for (const field of FIELD_MAPPING_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0);
      expect(field.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("BLANKABLE_FIELD_MAPPING_FIELDS", () => {
  it("excludes only 'source' (the one field applyFieldMapping falls back for)", () => {
    expect(BLANKABLE_FIELD_MAPPING_FIELDS.map((field) => field.key)).toEqual(
      FIELD_MAPPING_KEYS.filter((key) => key !== "source"),
    );
  });
});

describe("fieldMappingToFormValues", () => {
  it("returns all-blank values for null", () => {
    expect(fieldMappingToFormValues(null)).toEqual({
      title: "",
      content: "",
      html: "",
      source: "",
      tags: "",
      created: "",
    });
  });

  it("returns all-blank values for a non-conforming stored value", () => {
    // Mirrors applyFieldMapping's own fallback (server/utils/fieldMapper.ts):
    // a mapping that doesn't validate is treated as "not configured", not as
    // an error the editor should surface.
    expect(fieldMappingToFormValues({ title: 42 })).toEqual({
      title: "",
      content: "",
      html: "",
      source: "",
      tags: "",
      created: "",
    });
  });

  it("returns all-blank values for an array", () => {
    expect(fieldMappingToFormValues(["title"])).toEqual({
      title: "",
      content: "",
      html: "",
      source: "",
      tags: "",
      created: "",
    });
  });

  it("carries over set fields and leaves the rest blank", () => {
    expect(
      fieldMappingToFormValues({ title: "data.subject", tags: "data.labels" }),
    ).toEqual({
      title: "data.subject",
      content: "",
      html: "",
      source: "",
      tags: "data.labels",
      created: "",
    });
  });
});

describe("formValuesToFieldMapping", () => {
  const blankValues = {
    title: "",
    content: "",
    html: "",
    source: "",
    tags: "",
    created: "",
  };

  it("returns null when every field is blank", () => {
    expect(formValuesToFieldMapping(blankValues)).toBeNull();
  });

  it("returns null when every field is only whitespace", () => {
    expect(
      formValuesToFieldMapping({ ...blankValues, title: "   ", tags: "\t" }),
    ).toBeNull();
  });

  it("trims values and omits blank fields", () => {
    expect(
      formValuesToFieldMapping({
        ...blankValues,
        title: "  data.subject  ",
        content: "data.body",
      }),
    ).toEqual({ title: "data.subject", content: "data.body" });
  });

  it("round-trips through fieldMappingToFormValues", () => {
    const original = { title: "data.subject", created: "data.ts" };
    const roundTripped = formValuesToFieldMapping(
      fieldMappingToFormValues(original),
    );
    expect(roundTripped).toEqual(original);
  });
});

describe("invalidFieldMappingFields", () => {
  const blankValues = {
    title: "",
    content: "",
    html: "",
    source: "",
    tags: "",
    created: "",
  };

  it("returns nothing when every field is blank", () => {
    expect(invalidFieldMappingFields(blankValues)).toEqual([]);
  });

  it("returns nothing when every non-blank field is a valid path", () => {
    expect(
      invalidFieldMappingFields({ ...blankValues, title: "data.subject" }),
    ).toEqual([]);
  });

  it("flags a non-blank field with an empty path segment", () => {
    const invalid = invalidFieldMappingFields({
      ...blankValues,
      title: "data..subject",
      content: ".data",
    });
    expect(invalid.map((field) => field.key)).toEqual(["title", "content"]);
  });

  it("does not flag a whitespace-only field (it's blank, not invalid)", () => {
    expect(invalidFieldMappingFields({ ...blankValues, title: "   " })).toEqual(
      [],
    );
  });

  it("flags a path containing a forbidden segment (e.g. __proto__)", () => {
    const invalid = invalidFieldMappingFields({
      ...blankValues,
      title: "data.__proto__.polluted",
    });
    expect(invalid.map((field) => field.key)).toEqual(["title"]);
  });

  it("flags a path exceeding the shared max length", () => {
    const invalid = invalidFieldMappingFields({
      ...blankValues,
      title: "a".repeat(201),
    });
    expect(invalid.map((field) => field.key)).toEqual(["title"]);
  });

  it("flags a path using array bracket syntax", () => {
    const invalid = invalidFieldMappingFields({
      ...blankValues,
      tags: "data.items[0].name",
    });
    expect(invalid.map((field) => field.key)).toEqual(["tags"]);
  });
});
