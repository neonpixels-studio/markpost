import {
  FIELD_MAPPING_KEYS,
  isFieldMappingConfig,
  type FieldMappingConfig,
} from "#shared/utils/fieldMapping";
import { ApiError } from "./errors";

function invalidFieldMappingError(): ApiError {
  return new ApiError(
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

// A conforming mapping with none of the recognized keys actually populated
// (`{}`, `{ foo: "bar" }`, or every recognized value blank/whitespace) reads
// back through applyFieldMapping (server/utils/fieldMapper.ts) exactly like a
// mapping with `title`/`content`/etc set to real paths that all happen to
// resolve to nothing: every field comes back empty, silently discarding the
// whole payload on every future delivery. Collapsing it to null here — the
// same value the sources UI's editor sends when every field is cleared (see
// app/utils/fieldMappingForm.ts's formValuesToFieldMapping) — makes a
// no-op mapping fail open to raw ingestion instead of failing closed to an
// empty record.
function hasAnyMappedField(fieldMapping: FieldMappingConfig): boolean {
  return FIELD_MAPPING_KEYS.some(
    (key) => (fieldMapping[key] ?? "").trim().length > 0,
  );
}

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
  if (value === null) {
    return null;
  }

  if (!isFieldMappingConfig(value)) {
    throw invalidFieldMappingError();
  }

  return hasAnyMappedField(value) ? value : null;
}
