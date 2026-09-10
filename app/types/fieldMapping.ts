// The field-mapping modal's contract, shared by FieldMappingModal.vue (which
// renders the form) and the sources page (which drives the flow) so a change
// to the shape can't leave the two out of sync.

export interface FieldMappingSource {
  uuid: string;
  name: string;
  // Raw stored value (see server/db/schema.ts's jsonb column) — the modal is
  // responsible for validating/normalizing it into form values.
  fieldMapping: unknown;
}

export interface FieldMappingState {
  source: FieldMappingSource;
}
