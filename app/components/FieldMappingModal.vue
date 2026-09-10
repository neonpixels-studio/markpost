<template>
  <div
    style="
      position: fixed;
      inset: 0;
      background: color-mix(in oklab, #000 46%, transparent);
      display: grid;
      place-items: center;
      z-index: 60;
      padding: 24px;
    "
    @click="handleBackdropClick"
  >
    <div
      class="card"
      style="
        width: 560px;
        max-width: 100%;
        max-height: 90%;
        overflow: auto;
        box-shadow: var(--sh-pop);
      "
      @click.stop
    >
      <!-- head -->
      <div
        class="row between"
        style="padding: 18px 24px; border-bottom: 1px solid var(--line)"
      >
        <div class="col" style="gap: 2px">
          <span
            class="mono faint"
            style="
              font-size: 10.5px;
              letter-spacing: 0.12em;
              text-transform: uppercase;
            "
          >
            {{ fieldMappingState.source.name }}
          </span>
          <h3 style="font-size: 17px; font-weight: 600">Field mapping</h3>
        </div>
        <button v-if="!submitting" class="icon-btn" @click="emit('close')">
          <AppIcon name="x" :size="18" />
        </button>
      </div>

      <div style="padding: 24px">
        <AppAlert
          v-if="error"
          tone="err"
          title="Failed to save"
          style="margin-bottom: 14px"
        >
          {{ error }}
        </AppAlert>

        <AppAlert tone="info" title="How mapping works">
          Each field is a dot path into the incoming JSON payload, e.g.
          <code class="mono">data.subject</code>. Once any field below is set,
          every field is read only from its own mapped path — a blank field is
          left empty, it does <strong>not</strong> fall back to that payload's
          raw top-level key. Clearing every field removes the mapping entirely
          and restores raw ingestion (top-level <code class="mono">title</code>,
          <code class="mono">content</code>, <code class="mono">html</code>,
          <code class="mono">tags</code>,
          <code class="mono">created</code> keys).
        </AppAlert>

        <AppAlert
          v-if="isPartialMapping"
          tone="warn"
          title="Partial mapping"
          style="margin-top: 14px"
        >
          Only some fields are mapped — the rest will be left empty on every
          delivery, even if the payload also has a matching top-level key.
        </AppAlert>

        <div class="col gap-4" style="margin-top: 18px">
          <AppField
            v-for="field in FIELD_MAPPING_FIELDS"
            :key="field.key"
            :label="field.label"
            :msg="field.hint"
          >
            <input
              v-model="formValues[field.key]"
              class="input mono"
              style="font-size: 13.5px"
              :placeholder="`e.g. ${field.key}`"
              :disabled="submitting"
            />
          </AppField>
        </div>

        <div
          class="row gap-3"
          style="justify-content: flex-end; margin-top: 22px"
        >
          <AppBtn variant="ghost" :disabled="submitting" @click="emit('close')"
            >cancel</AppBtn
          >
          <AppBtn
            variant="accent"
            icon="check"
            :disabled="submitting"
            @click="handleSave"
            >save mapping</AppBtn
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  FIELD_MAPPING_FIELDS,
  fieldMappingToFormValues,
  formValuesToFieldMapping,
} from "../utils/fieldMappingForm";
import type { FieldMappingConfig } from "#shared/utils/fieldMapping";
import type { FieldMappingState } from "~/types/fieldMapping";

const props = withDefaults(
  defineProps<{
    fieldMappingState: FieldMappingState;
    // True while the parent's save request is in flight — guards against a
    // double-click firing two saves.
    submitting?: boolean;
    error?: string | null;
  }>(),
  { submitting: false, error: null },
);

const emit = defineEmits<{
  close: [];
  save: [fieldMapping: FieldMappingConfig | null];
}>();

// Seeded once from the opening state, not kept in sync with it afterwards —
// this is a form the user edits locally until they save, not a live mirror.
const formValues = ref(
  fieldMappingToFormValues(props.fieldMappingState.source.fieldMapping),
);

// applyFieldMapping (server/utils/fieldMapper.ts) has no per-field fallback:
// once any field is mapped, every field is read only from its own path, and
// an unmapped field is left empty rather than falling back to that payload's
// raw top-level key. A form with some fields set and others blank is the one
// shape most likely to surprise the user with silently-dropped data, so it
// gets its own warning alongside the general explanation above.
const isPartialMapping = computed(() => {
  const filledCount = FIELD_MAPPING_FIELDS.filter(
    (field) => formValues.value[field.key].trim().length > 0,
  ).length;
  return filledCount > 0 && filledCount < FIELD_MAPPING_FIELDS.length;
});

function handleSave(): void {
  if (props.submitting) {
    return;
  }
  emit("save", formValuesToFieldMapping(formValues.value));
}

function handleBackdropClick(): void {
  if (props.submitting) {
    return;
  }
  emit("close");
}
</script>
