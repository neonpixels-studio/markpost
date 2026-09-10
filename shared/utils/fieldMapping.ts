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
