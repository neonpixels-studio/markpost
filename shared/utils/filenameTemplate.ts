// filenameTemplate drives buildFilename() in server/utils/markdown.ts, which
// substitutes the dynamic tokens below and uses the result as every record's
// file_path. A template carrying none of those tokens (e.g. "notes.md") renders
// to a constant path, so every record collides on the file_path unique index
// and forces insertRecordWithUniqueFilePath to re-suffix on every insert. This
// contract rejects that footgun (plus empty, over-long, and non-markdown
// templates) so the value is validated the same way whether it arrives on
// create or update. It validates values at write time only; rows written
// before this existed are not covered here.

export const FILENAME_TEMPLATE_MAX_LENGTH = 255;

export const FILENAME_TEMPLATE_EXTENSION = ".md";

// The dynamic tokens buildFilename() substitutes. A template must contain at
// least one so it isn't a constant string that maps every record onto a single
// file_path; {{slug}} varies per record, {{date}} per day, {{source}} per
// source, and the user's conflictStrategy handles any remaining same-key
// collisions. Keep in sync with the replacements in buildFilename()
// (server/utils/markdown.ts).
export const FILENAME_TEMPLATE_VARIABLES = ["date", "slug", "source"] as const;

export type FilenameTemplateViolation =
  | "not-a-string"
  | "empty"
  | "too-long"
  | "missing-placeholder"
  | "missing-extension";

function placeholderToken(variable: string): string {
  return `{{${variable}}}`;
}

function hasDynamicPlaceholder(value: string): boolean {
  return FILENAME_TEMPLATE_VARIABLES.some((variable) =>
    value.includes(placeholderToken(variable)),
  );
}

function hasMarkdownExtension(value: string): boolean {
  return value.toLowerCase().endsWith(FILENAME_TEMPLATE_EXTENSION);
}

// Returns the first violation found, or null when the template is safe to
// persist. Callers map the violation to their own error shape.
export function filenameTemplateViolation(
  value: string,
): FilenameTemplateViolation | null {
  if (value.trim() === "") {
    return "empty";
  }
  if (value.length > FILENAME_TEMPLATE_MAX_LENGTH) {
    return "too-long";
  }
  if (!hasDynamicPlaceholder(value)) {
    return "missing-placeholder";
  }
  if (!hasMarkdownExtension(value)) {
    return "missing-extension";
  }
  return null;
}
