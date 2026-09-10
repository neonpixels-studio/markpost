import {
  isFieldMappingConfig,
  type FieldMappingConfig,
} from "#shared/utils/fieldMapping";
import { ApiError } from "./errors";

// Both the create (index.post.ts) and patch ([uuid].patch.ts) source
// endpoints accept fieldMapping as part of their JSON:API body; this is the
// one place either validates it, so the two — and the shape the sources UI's
// editor builds (see app/utils/fieldMappingForm.ts) — can't drift on what
// "invalid" means. Call only when the attribute was actually supplied
// (`!== undefined`); a caller that omits fieldMapping entirely should leave it
// untouched, not be forced to send an explicit null.
export function assertValidFieldMapping(
  value: unknown,
): FieldMappingConfig | null {
  if (value === null || isFieldMappingConfig(value)) {
    return value;
  }

  throw new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail:
          "fieldMapping must be null, or an object whose title/content/html/source/tags/created values (if present) are strings.",
        source: { pointer: "/data/attributes/fieldMapping" },
      },
    ],
    422,
  );
}
