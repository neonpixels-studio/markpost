import { describe, it, expect } from "vitest";
import {
  vaultDirViolation,
  VAULT_DIR_MAX_LENGTH,
} from "#shared/utils/vaultDir";

describe("vaultDirViolation", () => {
  const validDirs = [
    "~/Documents/Vault",
    "/Users/dan/Notes",
    "C:\\Users\\dan\\Vault",
    "relative/notes",
    "vault with space/sub",
    "año/notes",
  ];

  it.each(validDirs)("accepts the legitimate vault dir %j", (value) => {
    expect(vaultDirViolation(value)).toBeNull();
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(vaultDirViolation("")).toBe("empty");
    expect(vaultDirViolation("   ")).toBe("empty");
  });

  it("rejects a value longer than the max length", () => {
    expect(vaultDirViolation("a".repeat(VAULT_DIR_MAX_LENGTH + 1))).toBe(
      "too-long",
    );
    expect(vaultDirViolation("a".repeat(VAULT_DIR_MAX_LENGTH))).toBeNull();
  });

  const traversalDirs = [
    "..",
    "../notes",
    "~/notes/../../etc",
    "notes\\..\\secret",
    ".. /etc",
  ];

  it.each(traversalDirs)("rejects the traversal path %j", (value) => {
    expect(vaultDirViolation(value)).toBe("traversal");
  });

  it("rejects a value containing a control character", () => {
    expect(vaultDirViolation("~/notes\u0000/vault")).toBe("invalid-characters");
    expect(vaultDirViolation("~/notes\u001f")).toBe("invalid-characters");
  });
});
