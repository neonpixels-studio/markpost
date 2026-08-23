// vaultDir is the base directory markpost-cli writes synced markdown into. It is
// the user's own local path, so — unlike routeFolder — absolute paths, a leading
// "~", and Windows drive letters are all legitimate and must be allowed. What it
// must reject is a value that is empty, absurdly long, escapes upward via ".."
// segments, or carries NUL/control characters that would corrupt a filesystem
// write. This contract is shared so create and update validate vaultDir the same
// way and can't drift. It validates values at write time only; rows written
// before this existed are not covered here.

export const VAULT_DIR_MAX_LENGTH = 1024;

// Path separators to split on when checking segments: forward slash plus the
// Windows backslash, since a vaultDir may be a Windows path.
const PATH_SEPARATORS = /[/\\]/;

// A component made only of two-or-more dots ("..", "...") is parent-directory
// traversal. Windows also strips trailing dots and spaces, so ".. " normalizes
// to ".." — comparison is done against the trimmed component to catch that.
const TRAVERSAL_SEGMENT = /^\.{2,}$/;

// NUL and C0 control characters cannot appear in a usable filesystem path and
// are a classic injection vector, so reject any value containing one.
const CONTROL_CHARACTERS = /[\x00-\x1f]/;

export type VaultDirViolation =
  "not-a-string" | "empty" | "too-long" | "traversal" | "invalid-characters";

function hasTraversalSegment(value: string): boolean {
  return value
    .split(PATH_SEPARATORS)
    .some((segment) => TRAVERSAL_SEGMENT.test(segment.trim()));
}

// Returns the first violation found, or null when the vaultDir is safe to
// persist. Callers map the violation to their own error shape.
export function vaultDirViolation(value: string): VaultDirViolation | null {
  if (value.trim() === "") {
    return "empty";
  }
  if (value.length > VAULT_DIR_MAX_LENGTH) {
    return "too-long";
  }
  if (CONTROL_CHARACTERS.test(value)) {
    return "invalid-characters";
  }
  if (hasTraversalSegment(value)) {
    return "traversal";
  }
  return null;
}
