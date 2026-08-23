import {
  filenameTemplateViolation,
  FILENAME_TEMPLATE_MAX_LENGTH,
  type FilenameTemplateViolation,
} from "#shared/utils/filenameTemplate";
import { ApiError } from "./errors";

const FILENAME_TEMPLATE_POINTER = "/data/attributes/filenameTemplate";

const VIOLATION_DETAIL: Record<FilenameTemplateViolation, string> = {
  "not-a-string": "FilenameTemplate must be a string",
  empty: "FilenameTemplate must not be empty",
  "too-long": `FilenameTemplate must be at most ${FILENAME_TEMPLATE_MAX_LENGTH} characters`,
  traversal: "FilenameTemplate must not contain path traversal segments (..)",
  "invalid-characters": "FilenameTemplate must not contain control characters",
  "missing-placeholder":
    "FilenameTemplate must contain at least one of {{date}}, {{slug}}, or {{source}} so it isn't a constant filename",
  "missing-extension": "FilenameTemplate must end with .md",
};

function filenameTemplateError(violation: FilenameTemplateViolation): ApiError {
  return new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail: VIOLATION_DETAIL[violation],
        source: { pointer: FILENAME_TEMPLATE_POINTER },
      },
    ],
    422,
  );
}

// Throws a 422 ApiError when filenameTemplate would render an unsafe or
// collision-prone file_path — the sole filenameTemplate validation, including
// the string-type check, so create and update can't drift. Returns the value
// unchanged on success so callers persist exactly what was validated.
export function assertValidFilenameTemplate(value: unknown): string {
  if (typeof value !== "string") {
    throw filenameTemplateError("not-a-string");
  }
  const violation = filenameTemplateViolation(value);
  if (violation !== null) {
    throw filenameTemplateError(violation);
  }
  return value;
}
