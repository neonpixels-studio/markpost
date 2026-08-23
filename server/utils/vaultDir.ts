import {
  vaultDirViolation,
  VAULT_DIR_MAX_LENGTH,
  type VaultDirViolation,
} from "#shared/utils/vaultDir";
import { ApiError } from "./errors";

const VAULT_DIR_POINTER = "/data/attributes/vaultDir";

const VIOLATION_DETAIL: Record<VaultDirViolation, string> = {
  "not-a-string": "VaultDir must be a string",
  empty: "VaultDir must not be empty",
  "too-long": `VaultDir must be at most ${VAULT_DIR_MAX_LENGTH} characters`,
  traversal: "VaultDir must not contain path traversal segments (..)",
  "invalid-characters": "VaultDir must not contain control characters",
};

function vaultDirError(violation: VaultDirViolation): ApiError {
  return new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail: VIOLATION_DETAIL[violation],
        source: { pointer: VAULT_DIR_POINTER },
      },
    ],
    422,
  );
}

// Throws a 422 ApiError when vaultDir is not a safe base directory — the sole
// vaultDir validation, including the string-type check, so create and update
// can't drift. Returns the value unchanged on success so callers persist
// exactly what was validated.
export function assertValidVaultDir(value: unknown): string {
  if (typeof value !== "string") {
    throw vaultDirError("not-a-string");
  }
  const violation = vaultDirViolation(value);
  if (violation !== null) {
    throw vaultDirError(violation);
  }
  return value;
}
