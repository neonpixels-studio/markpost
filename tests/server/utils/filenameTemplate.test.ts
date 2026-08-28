import { describe, it, expect } from "vitest";
import { assertValidFilenameTemplate } from "../../../server/utils/filenameTemplate";
import { ApiError } from "../../../server/utils/errors";

describe("assertValidFilenameTemplate", () => {
  it("returns the value unchanged for a valid template", () => {
    expect(assertValidFilenameTemplate("{{date}}-{{slug}}.md")).toBe(
      "{{date}}-{{slug}}.md",
    );
  });

  it("throws a 422 ApiError when the value is not a string", () => {
    expect(() => assertValidFilenameTemplate(42)).toThrow(ApiError);
    try {
      assertValidFilenameTemplate(42);
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.statusCode).toBe(422);
      expect(apiError.errors[0].detail).toContain("must be a string");
      expect(apiError.errors[0].source?.pointer).toBe(
        "/data/attributes/filenameTemplate",
      );
    }
  });

  it("maps a placeholder-free template to a 422 ApiError", () => {
    try {
      assertValidFilenameTemplate("notes.md");
      throw new Error("expected assertValidFilenameTemplate to throw");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.statusCode).toBe(422);
      expect(apiError.errors[0].detail).toContain("{{slug}}");
    }
  });
});
