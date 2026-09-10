import {
  FIELD_MAPPING_KEYS,
  isFieldMappingConfig,
  isValidFieldMappingPath,
  type FieldMappingConfig,
} from "#shared/utils/fieldMapping";

// Drives FieldMappingModal.vue's form: one text input per mapping key, each
// holding the dot-path into the incoming JSON payload.
export type FieldMappingFormValues = Record<
  (typeof FIELD_MAPPING_KEYS)[number],
  string
>;

export interface FieldMappingFieldMeta {
  key: (typeof FIELD_MAPPING_KEYS)[number];
  label: string;
  hint: string;
}

export const FIELD_MAPPING_FIELDS: FieldMappingFieldMeta[] = [
  {
    key: "title",
    label: "Title",
    hint: "Dot path to the record title, e.g. data.subject",
  },
  {
    key: "content",
    label: "Content",
    hint: "Dot path to the markdown/plain-text body",
  },
  {
    key: "html",
    label: "HTML",
    hint: "Dot path to an HTML body — converted to markdown",
  },
  {
    key: "source",
    label: "Source",
    hint: "Dot path to override the source name shown on the record",
  },
  {
    key: "tags",
    label: "Tags",
    hint: "Dot path to a tags array, or a comma-separated string",
  },
  {
    key: "created",
    label: "Created",
    hint: "Dot path to an ISO timestamp",
  },
];

function emptyFormValues(): FieldMappingFormValues {
  return {
    title: "",
    content: "",
    html: "",
    source: "",
    tags: "",
    created: "",
  };
}

// Stored fieldMapping is arbitrary jsonb (see server/db/schema.ts) — a value
// set outside this UI (raw PATCH, or a shape from a previous contract) may not
// conform. The ingest pipeline already treats a non-conforming mapping as "not
// configured" (see server/utils/fieldMapper.ts's applyFieldMapping); the form
// mirrors that rather than throwing on the edge case.
export function fieldMappingToFormValues(
  fieldMapping: unknown,
): FieldMappingFormValues {
  const values = emptyFormValues();

  if (!isFieldMappingConfig(fieldMapping)) {
    return values;
  }

  for (const key of FIELD_MAPPING_KEYS) {
    values[key] = fieldMapping[key] ?? "";
  }

  return values;
}

// Every non-blank field whose path can never resolve to anything — surfaced
// by the modal as a blocking error rather than allowed to save silently. Uses
// the same isValidFieldMappingPath the server enforces at write time (see
// server/utils/fieldMappingValidation.ts), so a path this form accepts can
// never be rejected — or silently accepted-but-inert — on the other side.
export function invalidFieldMappingFields(
  values: FieldMappingFormValues,
): FieldMappingFieldMeta[] {
  return FIELD_MAPPING_FIELDS.filter((field) => {
    const trimmed = values[field.key].trim();
    return trimmed.length > 0 && !isValidFieldMappingPath(trimmed);
  });
}

// Trims every field and drops blanks. Returns null when nothing is left —
// a source is "unmapped" (raw ingestion) both when it was created that way
// and when every field has since been cleared back to blank. Callers should
// check invalidFieldMappingFields first — this function doesn't validate dot
// paths itself, it only decides what's blank.
export function formValuesToFieldMapping(
  values: FieldMappingFormValues,
): FieldMappingConfig | null {
  const fieldMapping: FieldMappingConfig = {};

  for (const key of FIELD_MAPPING_KEYS) {
    const trimmed = values[key].trim();
    if (trimmed.length > 0) {
      fieldMapping[key] = trimmed;
    }
  }

  return Object.keys(fieldMapping).length > 0 ? fieldMapping : null;
}
