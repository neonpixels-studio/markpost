import { describe, it, expect } from "vitest";
import { assertValidFieldMapping } from "../../../server/utils/fieldMappingValidation";
import { ApiError } from "../../../server/utils/errors";

describe("assertValidFieldMapping", () => {
  it("returns null unchanged", () => {
    expect(assertValidFieldMapping(null)).toBeNull();
  });

  it("returns a conforming mapping unchanged", () => {
    const mapping = { title: "data.subject", tags: "data.labels" };
    expect(assertValidFieldMapping(mapping)).toBe(mapping);
  });

  it("normalizes an empty object to null (no recognized field is mapped)", () => {
    // Storing {} verbatim would make applyFieldMapping (server/utils/
    // fieldMapper.ts) take the "mapped" branch and return every field
    // undefined — silently discarding every future delivery's payload.
    expect(assertValidFieldMapping({})).toBeNull();
  });

  it("normalizes an object with only unrecognized keys to null", () => {
    expect(assertValidFieldMapping({ foo: "bar" })).toBeNull();
  });

  it("normalizes an object whose recognized values are all blank/whitespace to null", () => {
    expect(assertValidFieldMapping({ title: "   ", content: "" })).toBeNull();
  });

  it("keeps a mapping with at least one populated recognized field", () => {
    const mapping = { title: "  ", content: "data.body" };
    expect(assertValidFieldMapping(mapping)).toBe(mapping);
  });

  it("throws a 422 ApiError for a non-string recognized key", () => {
    expect(() => assertValidFieldMapping({ title: 42 })).toThrow(ApiError);
    try {
      assertValidFieldMapping({ title: 42 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(422);
      expect((error as ApiError).errors[0]).toMatchObject({
        status: "422",
        title: "Invalid Attribute",
        source: { pointer: "/data/attributes/fieldMapping" },
      });
    }
  });

  it("throws for an array", () => {
    expect(() => assertValidFieldMapping(["title"])).toThrow(ApiError);
  });

  it("throws for a primitive", () => {
    expect(() => assertValidFieldMapping("title")).toThrow(ApiError);
  });
});
