import { describe, expect, it } from "vitest";
import { apiValidate } from "../../../server/utils/validate";
import { ApiError } from "../../../server/utils/errors";
import type { ApiRequest } from "../../../server/types/api.types";

function buildRequest(attributes: Record<string, unknown>): ApiRequest {
  return { data: { attributes } };
}

describe("apiValidate", () => {
  it("returns without throwing when all required attributes are present", () => {
    const body = buildRequest({ title: "Hello", content: "World" });

    expect(() =>
      apiValidate(body, [{ key: "title" }, { key: "content" }]),
    ).not.toThrow();
  });

  it("treats a completely absent key as a missing attribute", () => {
    const body = buildRequest({ title: "Hello" });

    expect(() =>
      apiValidate(body, [{ key: "title" }, { key: "content" }]),
    ).toThrow(ApiError);
  });

  it("throws an ApiError with status 422 when one attribute is missing", () => {
    const body = buildRequest({ title: "Hello", content: "" });

    expect(() =>
      apiValidate(body, [{ key: "title" }, { key: "content" }]),
    ).toThrow(ApiError);

    try {
      apiValidate(body, [{ key: "title" }, { key: "content" }]);
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.statusCode).toBe(422);
      expect(apiError.errors).toEqual([
        {
          status: "422",
          title: "Invalid Attribute",
          detail: "Content is required",
          source: { pointer: "/data/attributes/content" },
        },
      ]);
    }
  });

  it("collects one error per missing attribute when multiple are missing", () => {
    const body = buildRequest({ title: "", content: null });

    try {
      apiValidate(body, [{ key: "title" }, { key: "content" }]);
      throw new Error("expected apiValidate to throw");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError).toBeInstanceOf(ApiError);
      expect(apiError.errors).toEqual([
        {
          status: "422",
          title: "Invalid Attribute",
          detail: "Title is required",
          source: { pointer: "/data/attributes/title" },
        },
        {
          status: "422",
          title: "Invalid Attribute",
          detail: "Content is required",
          source: { pointer: "/data/attributes/content" },
        },
      ]);
    }
  });

  it.each([
    { label: "body.data is missing", body: {} },
    { label: "body.data.attributes is missing", body: { data: {} } },
  ])("throws a 422 when $label", ({ body }) => {
    const request = body as unknown as ApiRequest;

    expect(() => apiValidate(request, [{ key: "title" }])).toThrow(ApiError);

    try {
      apiValidate(request, [{ key: "title" }]);
    } catch (error) {
      expect((error as ApiError).statusCode).toBe(422);
    }
  });

  it("uses a custom message when the rule provides one", () => {
    const body = buildRequest({ title: undefined });

    try {
      apiValidate(body, [{ key: "title", message: "Please provide a title." }]);
      throw new Error("expected apiValidate to throw");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.errors).toEqual([
        {
          status: "422",
          title: "Invalid Attribute",
          detail: "Please provide a title.",
          source: { pointer: "/data/attributes/title" },
        },
      ]);
    }
  });

  it("does not throw when an optional attribute is absent", () => {
    const body = buildRequest({});

    expect(() =>
      apiValidate(body, [{ key: "title", optional: true }]),
    ).not.toThrow();
  });

  it("throws a 422 when an optional attribute is present but has the wrong type", () => {
    const body = buildRequest({ count: "not-a-boolean" });

    expect(() =>
      apiValidate(body, [{ key: "count", type: "boolean", optional: true }]),
    ).toThrow(ApiError);

    try {
      apiValidate(body, [{ key: "count", type: "boolean", optional: true }]);
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.statusCode).toBe(422);
      expect(apiError.errors[0].detail).toBe("Count must be a boolean");
    }
  });

  it("throws a 422 when an enum attribute has a value not in the allowed list", () => {
    const body = buildRequest({ strategy: "invalid" });

    expect(() =>
      apiValidate(body, [
        {
          key: "strategy",
          type: "string",
          optional: true,
          enum: ["suffix", "overwrite", "skip"] as const,
        },
      ]),
    ).toThrow(ApiError);

    try {
      apiValidate(body, [
        {
          key: "strategy",
          type: "string",
          optional: true,
          enum: ["suffix", "overwrite", "skip"] as const,
        },
      ]);
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.statusCode).toBe(422);
      expect(apiError.errors[0].detail).toBe(
        "Strategy must be one of: suffix, overwrite, skip",
      );
    }
  });

  it("does not throw when an enum attribute has a valid value", () => {
    const body = buildRequest({ strategy: "overwrite" });

    expect(() =>
      apiValidate(body, [
        {
          key: "strategy",
          type: "string",
          optional: true,
          enum: ["suffix", "overwrite", "skip"] as const,
        },
      ]),
    ).not.toThrow();
  });

  describe("pattern rule", () => {
    function captureApiError(run: () => void): ApiError {
      try {
        run();
      } catch (error) {
        return error as ApiError;
      }
      throw new Error("Expected apiValidate to throw");
    }

    const rules = [
      { key: "code", type: "string" as const, pattern: /^[a-z]+$/ },
    ];

    it("passes a value matching the pattern", () => {
      expect(() =>
        apiValidate(buildRequest({ code: "abc" }), rules),
      ).not.toThrow();
    });

    it("rejects a value not matching the pattern with a 422 pointing at the attribute", () => {
      const apiError = captureApiError(() =>
        apiValidate(buildRequest({ code: "ABC1" }), rules),
      );

      expect(apiError.statusCode).toBe(422);
      expect(apiError.errors).toEqual([
        {
          status: "422",
          title: "Invalid Attribute",
          detail: "Code has an invalid format",
          source: { pointer: "/data/attributes/code" },
        },
      ]);
    });

    it("uses patternMessage when provided", () => {
      const custom = [{ ...rules[0], patternMessage: "Nope" }];

      const apiError = captureApiError(() =>
        apiValidate(buildRequest({ code: "1" }), custom),
      );

      expect(apiError.errors[0].detail).toBe("Nope");
    });

    it("rejects a non-string value when the rule has a pattern but no type", () => {
      const apiError = captureApiError(() =>
        apiValidate(buildRequest({ code: 123 }), [
          { key: "code", pattern: /^[a-z]+$/ },
        ]),
      );

      expect(apiError.errors[0].detail).toBe("Code has an invalid format");
    });

    it("stays stateless for a global regex across repeated calls", () => {
      const globalRules = [{ key: "code", pattern: /^[a-z]+$/g }];

      expect(() =>
        apiValidate(buildRequest({ code: "abc" }), globalRules),
      ).not.toThrow();
      expect(() =>
        apiValidate(buildRequest({ code: "abc" }), globalRules),
      ).not.toThrow();
    });

    it("skips the pattern for an absent optional value", () => {
      const optional = [{ ...rules[0], optional: true }];

      expect(() => apiValidate(buildRequest({}), optional)).not.toThrow();
    });
  });
});
