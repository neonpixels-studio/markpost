import {
  FIELD_MAPPING_KEYS,
  isFieldMappingConfig,
  isValidFieldMappingPath,
  type FieldMappingConfig,
} from "#shared/utils/fieldMapping";
import { ApiError } from "./errors";

function invalidFieldMappingError(detail: string): ApiError {
  return new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail,
        source: { pointer: "/data/attributes/fieldMapping" },
      },
    ],
    422,
  );
}

const SHAPE_ERROR_DETAIL =
  "fieldMapping must be null, or an object whose title/content/html/source/tags/created values (if present) are strings.";

function pathErrorDetail(key: string): string {
  return `fieldMapping.${key} must be a non-empty dot path with no empty, forbidden, or overlong segments.`;
}

// Builds the value actually persisted: trimmed, recognized keys only, blank
// values dropped. Any unrecognized key on an otherwise-conforming object
// (isFieldMappingConfig is deliberately forward-compatible about those) is
// silently dropped rather than stored — there's nothing in the ingest
// pipeline that will ever read it, and the sources UI's own editor
// (app/utils/fieldMappingForm.ts's formValuesToFieldMapping) never writes one
// either, so keeping it would only let an authenticated client park unbounded
// junk in the jsonb column.
function normalizeAndValidate(fieldMapping: FieldMappingConfig): {
  normalized: FieldMappingConfig;
  invalidKey: string | null;
} {
  const normalized: FieldMappingConfig = {};

  for (const key of FIELD_MAPPING_KEYS) {
    const trimmed = (fieldMapping[key] ?? "").trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!isValidFieldMappingPath(trimmed)) {
      return { normalized, invalidKey: key };
    }
    normalized[key] = trimmed;
  }

  return { normalized, invalidKey: null };
}

// Both the create (index.post.ts) and patch ([uuid].patch.ts) source
// endpoints accept fieldMapping as part of their JSON:API body; this is the
// one place either validates it, so the two — and the shape the sources UI's
// editor builds (see app/utils/fieldMappingForm.ts) — can't drift on what
// "invalid" means. Call only when the attribute was actually supplied
// (`!== undefined`); a caller that omits fieldMapping entirely should leave it
// untouched, not be forced to send an explicit null.
//
// A mapping that conforms in shape but resolves to nothing once normalized —
// `{}`, `{ foo: "bar" }`, or every recognized value blank/whitespace — is
// collapsed to null rather than stored as-is. applyFieldMapping (server/
// utils/fieldMapper.ts) takes its "mapped" branch for any conforming object,
// recognized fields or not, and returns every field undefined; storing that
// verbatim would silently discard every future delivery's payload. null is
// the same value the UI sends when every field is cleared, so a no-op
// mapping fails open to raw ingestion instead of failing closed to an empty
// record.
export function assertValidFieldMapping(
  value: unknown,
): FieldMappingConfig | null {
  if (value === null) {
    return null;
  }

  if (!isFieldMappingConfig(value)) {
    throw invalidFieldMappingError(SHAPE_ERROR_DETAIL);
  }

  const { normalized, invalidKey } = normalizeAndValidate(value);
  if (invalidKey !== null) {
    throw invalidFieldMappingError(pathErrorDetail(invalidKey));
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}
