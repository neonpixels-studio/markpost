import { describe, it, expect } from "vitest";
import {
  FIELD_MAPPING_FIELDS,
  fieldMappingToFormValues,
  formValuesToFieldMapping,
} from "../../app/utils/fieldMappingForm";

describe("FIELD_MAPPING_FIELDS", () => {
  it("has one entry per recognized mapping key", () => {
    expect(FIELD_MAPPING_FIELDS.map((field) => field.key)).toEqual([
      "title",
      "content",
      "html",
      "source",
      "tags",
      "created",
    ]);
  });

  it("gives every field a non-empty label and hint", () => {
    for (const field of FIELD_MAPPING_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0);
      expect(field.hint.length).toBeGreaterThan(0);
    }
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
