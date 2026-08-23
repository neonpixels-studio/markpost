import {
  hasControlCharacters,
  hasTraversalSegment,
} from "#shared/utils/pathSafety";

// vaultDir is the base directory markpost-cli writes synced markdown into. It is
// the user's own local path, so — unlike routeFolder — absolute paths, a leading
// "~", and Windows drive letters are all legitimate and must be allowed. What it
// must reject is a value that is empty, absurdly long, escapes upward via ".."
// segments, or carries NUL/control characters that would corrupt a filesystem
// write. This contract is shared so create and update validate vaultDir the same
// way and can't drift. It validates values at write time only; rows written
// before this existed are not covered here.

export const VAULT_DIR_MAX_LENGTH = 1024;

export type VaultDirViolation =
  "not-a-string" | "empty" | "too-long" | "traversal" | "invalid-characters";

// Returns the first violation found, or null when the vaultDir is safe to
// persist. Callers map the violation to their own error shape.
export function vaultDirViolation(value: string): VaultDirViolation | null {
  if (value.trim() === "") {
    return "empty";
  }
  if (value.length > VAULT_DIR_MAX_LENGTH) {
    return "too-long";
  }
  if (hasControlCharacters(value)) {
    return "invalid-characters";
  }
  if (hasTraversalSegment(value)) {
    return "traversal";
  }
  return null;
}
