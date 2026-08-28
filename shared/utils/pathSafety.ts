// Shared path-safety primitives for the settings attributes that become
// filesystem paths on the markpost-cli side (vaultDir as the base directory,
// filenameTemplate as the leaf). Both must reject the same two hazards —
// parent-directory traversal and control characters — so they live here rather
// than being copy-pasted into each validator.

// Path separators to split on: forward slash plus the Windows backslash, since
// a value may be a Windows path.
const PATH_SEPARATORS = /[/\\]/;

// A component made only of two-or-more dots ("..", "...") is parent-directory
// traversal. Windows also strips trailing dots and spaces, so ".. " normalizes
// to ".." — comparison is done against the trimmed component to catch that.
const TRAVERSAL_SEGMENT = /^\.{2,}$/;

// NUL, the C0 control range, and DEL cannot appear in a usable filesystem path
// and are a classic injection vector, so reject any value containing one.
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

export function hasTraversalSegment(value: string): boolean {
  return value
    .split(PATH_SEPARATORS)
    .some((segment) => TRAVERSAL_SEGMENT.test(segment.trim()));
}

export function hasControlCharacters(value: string): boolean {
  return CONTROL_CHARACTERS.test(value);
}
