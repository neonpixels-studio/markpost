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

// A plain array here (rather than derived from FIELD_MAPPING_KEYS) would let
// a new key added to that list compile silently with no input rendered for
// it — and since formValuesToFieldMapping only ever writes what the form
// holds, the first save on a source that already has that key stored would
// silently delete it. Keying by FIELD_MAPPING_KEYS makes a missing label/hint
// a type error instead.
const FIELD_MAPPING_META: Record<
  (typeof FIELD_MAPPING_KEYS)[number],
  Pick<FieldMappingFieldMeta, "label" | "hint">
> = {
  title: {
    label: "Title",
    hint: "Dot path to the record title, e.g. data.subject",
  },
  content: {
    label: "Content",
    hint: "Dot path to the markdown/plain-text body",
  },
  html: {
    label: "HTML",
    hint: "Dot path to an HTML body — converted to markdown",
  },
  source: {
    label: "Source",
    hint: "Dot path to override the source name shown on the record",
  },
  tags: {
    label: "Tags",
    hint: "Dot path to a tags array — use a numeric segment for an index, e.g. data.items.0",
  },
  created: {
    label: "Created",
    hint: "Dot path to an ISO timestamp",
  },
};

export const FIELD_MAPPING_FIELDS: FieldMappingFieldMeta[] =
  FIELD_MAPPING_KEYS.map((key) => ({ key, ...FIELD_MAPPING_META[key] }));

// applyFieldMapping (server/utils/fieldMapper.ts) falls back to the source's
// own name only for `source` — every other field is simply left empty when
// unmapped. A blank `source` is therefore never a sign of a half-finished
// mapping the way a blank title/content/html/tags/created is, so it's
// excluded from the partial-mapping check below (see isPartialMapping in
// FieldMappingModal.vue): otherwise a fully-intentional mapping of the other
// five fields would show a "some fields are blank" warning forever, since
// `source` almost never needs to be set explicitly.
export const BLANKABLE_FIELD_MAPPING_FIELDS = FIELD_MAPPING_FIELDS.filter(
  (field) => field.key !== "source",
);

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
