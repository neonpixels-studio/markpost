import { EMAIL_SOURCE_TYPE } from "./sourceTypes";

// The field-mapping contract: a source's `fieldMapping` column is stored as
// arbitrary jsonb, but only this shape is ever recognized by the ingest
// pipeline (see server/utils/fieldMapper.ts's applyFieldMapping) or editable
// from the sources UI (see app/components/FieldMappingModal.vue). Shared here
// so both sides validate and build the same shape rather than drifting.
export type FieldMappingConfig = {
  title?: string;
  content?: string;
  html?: string;
  source?: string;
  tags?: string;
  created?: string;
};

export const FIELD_MAPPING_KEYS = [
  "title",
  "content",
  "html",
  "source",
  "tags",
  "created",
] as const satisfies readonly (keyof FieldMappingConfig)[];

export function isFieldMappingConfig(
  value: unknown,
): value is FieldMappingConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  for (const key of FIELD_MAPPING_KEYS) {
    if (key in candidate && typeof candidate[key] !== "string") {
      return false;
    }
  }

  return true;
}

// Segments getNestedValue (server/utils/fieldMapper.ts) refuses to read no
// matter what the payload actually contains — kept here, not duplicated in
// fieldMapper.ts, so the UI's live validation and the server's write-time
// validation (server/utils/fieldMappingValidation.ts) can't drift on which
// paths are reachable.
export const FIELD_MAPPING_FORBIDDEN_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

// Generous enough for any real JSON path; short enough that an authenticated
// PATCH can't park an unbounded string in the jsonb column.
export const FIELD_MAPPING_PATH_MAX_LENGTH = 200;

const DOT_PATH_PATTERN = /^[^.]+(\.[^.]+)*$/;

// getNestedValue (server/utils/fieldMapper.ts) walks a path with a plain
// `hasOwnProperty` per segment — it has no bracket-index syntax, so
// "items[0]" is looked up as the literal property name `items[0]`, which
// essentially never exists (array indices resolve via the plain numeric
// segment "0" instead, since hasOwnProperty(array, "0") is true).
function hasArrayBracketSyntax(segment: string): boolean {
  return segment.includes("[") || segment.includes("]");
}

function isResolvableSegment(segment: string): boolean {
  return (
    segment.trim().length > 0 &&
    !hasArrayBracketSyntax(segment) &&
    !FIELD_MAPPING_FORBIDDEN_SEGMENTS.has(segment)
  );
}

// A dot path is only useful if getNestedValue (server/utils/fieldMapper.ts)
// can actually resolve it: no empty or whitespace-only segment
// (leading/trailing/doubled dot, or a typo'd blank), no bracket-index syntax
// (unsupported — use a numeric segment instead, e.g. "items.0"), no forbidden
// segment, and within the length cap. Shared so app/utils/fieldMappingForm.ts's
// live form validation and server/utils/fieldMappingValidation.ts's
// write-time validation enforce identically rather than one silently
// accepting what the other rejects.
export function isValidFieldMappingPath(path: string): boolean {
  if (path.length === 0 || path.length > FIELD_MAPPING_PATH_MAX_LENGTH) {
    return false;
  }

  if (!DOT_PATH_PATTERN.test(path)) {
    return false;
  }

  return path.split(".").every(isResolvableSegment);
}

// A stored mapping is worth surfacing only if it's both a shape the editor
// can actually read (see fieldMappingToFormValues, which blanks out anything
// isFieldMappingConfig rejects) and has at least one field genuinely
// populated — the same "does this mapping do anything" test
// server/utils/fieldMappingValidation.ts's assertValidFieldMapping applies
// before persisting one. `unknown` is deliberate here (not `=== null`): the
// attribute is typed unknown throughout the client (see
// app/composables/useSources.ts), so a fixture or a future partial response
// that omits it entirely (`undefined`) must not be treated as "has a mapping".
function hasMeaningfulFieldMapping(fieldMapping: unknown): boolean {
  return (
    isFieldMappingConfig(fieldMapping) &&
    FIELD_MAPPING_KEYS.some(
      (key) => (fieldMapping[key] ?? "").trim().length > 0,
    )
  );
}

// applyFieldMapping has exactly one caller — the JSON webhook ingest handler
// (server/api/hooks/[slug].post.ts). Email deliveries never reach it, so
// configuring a mapping on an email source normally does nothing — the
// sources UI hides the editor for one UNLESS it already has a stored mapping
// (set via the API before this UI existed, or by some other caller), in
// which case it stays reachable so it can still be inspected and cleared.
// Shared so app/components/SourceCard.vue (which hides the button) and
// app/pages/sources.vue (which drives the flow the button opens) can't drift
// on the gate — the same relationship isRotatableProvider has to the
// rotate-secret button/flow (#shared/utils/webhookSecrets).
export function isSourceMappable(
  sourceType: string,
  fieldMapping: unknown,
): boolean {
  if (sourceType !== EMAIL_SOURCE_TYPE) {
    return true;
  }
  return hasMeaningfulFieldMapping(fieldMapping);
}
