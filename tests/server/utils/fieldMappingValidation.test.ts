import { describe, it, expect } from "vitest";
import { assertValidFieldMapping } from "../../../server/utils/fieldMappingValidation";
import { ApiError } from "../../../server/utils/errors";
import { FIELD_MAPPING_PATH_MAX_LENGTH } from "#shared/utils/fieldMapping";

function expectApiError(
  fn: () => unknown,
  matcher: Record<string, unknown> = {},
) {
  try {
    fn();
    expect.unreachable("expected assertValidFieldMapping to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(422);
    expect((error as ApiError).errors[0]).toMatchObject({
      status: "422",
      title: "Invalid Attribute",
      source: { pointer: "/data/attributes/fieldMapping" },
      ...matcher,
    });
  }
}

describe("assertValidFieldMapping", () => {
  it("returns null unchanged", () => {
    expect(assertValidFieldMapping(null)).toBeNull();
  });

  it("returns an equivalent mapping for already-clean input", () => {
    expect(
      assertValidFieldMapping({
        title: "data.subject",
        tags: "data.labels",
      }),
    ).toEqual({ title: "data.subject", tags: "data.labels" });
  });

  it("trims whitespace around a populated value", () => {
    expect(assertValidFieldMapping({ title: "  data.subject  " })).toEqual({
      title: "data.subject",
    });
  });

  it("drops unrecognized keys rather than storing them", () => {
    // isFieldMappingConfig is deliberately forward-compatible about unknown
    // keys, but nothing in the ingest pipeline or the UI's own editor ever
    // reads or writes one — keeping it would only let a client park unbounded
    // junk in the jsonb column.
    expect(
      assertValidFieldMapping({ title: "data.subject", junk: "ignored" }),
    ).toEqual({ title: "data.subject" });
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

  it("keeps a mapping with at least one populated recognized field, dropping the blank one", () => {
    expect(
      assertValidFieldMapping({ title: "  ", content: "data.body" }),
    ).toEqual({ content: "data.body" });
  });

  it("throws a 422 ApiError for a non-string recognized key", () => {
    expectApiError(() => assertValidFieldMapping({ title: 42 }));
  });

  it("throws for an array", () => {
    expect(() => assertValidFieldMapping(["title"])).toThrow(ApiError);
  });

  it("throws for a primitive", () => {
    expect(() => assertValidFieldMapping("title")).toThrow(ApiError);
  });

  it("throws for a path with an empty segment", () => {
    expectApiError(() => assertValidFieldMapping({ title: "data..subject" }));
  });

  it("throws for a path containing a forbidden segment", () => {
    expectApiError(() =>
      assertValidFieldMapping({ title: "data.__proto__.polluted" }),
    );
  });

  it("throws for a path exceeding the max length", () => {
    expectApiError(() =>
      assertValidFieldMapping({
        title: "a".repeat(FIELD_MAPPING_PATH_MAX_LENGTH + 1),
      }),
    );
  });
});
