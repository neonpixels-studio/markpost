import { describe, it, expect } from "vitest";
import { assertValidVaultDir } from "../../../server/utils/vaultDir";
import { ApiError } from "../../../server/utils/errors";

describe("assertValidVaultDir", () => {
  it("returns the value unchanged for a valid vault dir", () => {
    expect(assertValidVaultDir("~/Documents/Vault")).toBe("~/Documents/Vault");
  });

  it("throws a 422 ApiError when the value is not a string", () => {
    expect(() => assertValidVaultDir(42)).toThrow(ApiError);
    try {
      assertValidVaultDir(42);
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.statusCode).toBe(422);
      expect(apiError.errors[0].detail).toContain("must be a string");
      expect(apiError.errors[0].source?.pointer).toBe(
        "/data/attributes/vaultDir",
      );
    }
  });

  it("maps a traversal path to a 422 ApiError", () => {
    try {
      assertValidVaultDir("~/notes/../../etc");
      throw new Error("expected assertValidVaultDir to throw");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.statusCode).toBe(422);
      expect(apiError.errors[0].detail).toContain("..");
    }
  });
});
