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
            {{ testEventState.source.name }}
          </span>
          <h3 style="font-size: 17px; font-weight: 600">Send test event</h3>
        </div>
        <button v-if="!submitting" class="icon-btn" @click="emit('close')">
          <AppIcon name="x" :size="18" />
        </button>
      </div>

      <div style="padding: 24px">
        <AppAlert
          v-if="error"
          tone="err"
          title="Test event failed"
          style="margin-bottom: 14px"
        >
          {{ error }}
        </AppAlert>

        <AppAlert tone="info" title="What this does">
          Runs the payload below through this source's real field mapping — the
          same code a live delivery runs — without creating a record. For
          GitHub/Stripe sources it also confirms the stored secret produces a
          signature this app accepts; it cannot confirm the provider's own copy
          of the secret matches (see the result below for details). Edit the
          payload to match your provider's actual shape, especially if this
          source has a custom field mapping.
        </AppAlert>

        <div style="margin-top: 16px">
          <InputTextarea
            v-model="payloadText"
            label="Test payload (JSON)"
            :rows="8"
            :state="payloadError ? 'err' : ''"
            :msg="payloadError ?? ''"
            class="mono"
            style="font-size: 12.5px"
            :disabled="submitting"
          />
        </div>

        <div
          class="row gap-3"
          style="justify-content: flex-end; margin-top: 22px"
        >
          <AppBtn variant="ghost" :disabled="submitting" @click="emit('close')"
            >close</AppBtn
          >
          <AppBtn
            variant="accent"
            icon="activity"
            :disabled="submitting || !!payloadError"
            @click="handleSend"
          >
            {{ testEventState.result ? "send again" : "send test event" }}
          </AppBtn>
        </div>

        <div v-if="testResult" class="col gap-4" style="margin-top: 22px">
          <AppAlert :tone="signatureTone" :title="signatureTitle">
            {{ testResult.signatureCheck.message }}
          </AppAlert>

          <div class="code">
            <div class="code-head">
              <span class="lang">field mapping result</span>
            </div>
            <div class="code-body mono col gap-2" style="font-size: 12.5px">
              <div>
                <span class="faint">title</span>
                {{ testResult.fieldMapping.title }}
              </div>
              <div>
                <span class="faint">content</span>
                {{ testResult.fieldMapping.content || "(empty)" }}
              </div>
              <div>
                <span class="faint">tags</span>
                {{
                  testResult.fieldMapping.tags.length
                    ? testResult.fieldMapping.tags.join(", ")
                    : "(none)"
                }}
              </div>
              <div>
                <span class="faint">file path</span>
                {{ testResult.fieldMapping.filePath }}
              </div>
              <div>
                <span class="faint">frontmatter</span>
                {{ frontmatterPreview }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TestEventState } from "~/types/testEvent";
import { buildTestEventSamplePayload } from "#shared/utils/testEventSamplePayload";

const props = withDefaults(
  defineProps<{
    testEventState: TestEventState;
    // True while the parent's send request is in flight — guards against a
    // double-click firing two sends.
    submitting?: boolean;
    // A send failure (network/validation error from the server), shown inline
    // so retry feedback sits with the retry control rather than behind the
    // modal's scrim.
    error?: string | null;
  }>(),
  { submitting: false, error: null },
);

const emit = defineEmits<{
  close: [];
  send: [payload: Record<string, unknown>];
}>();

// Seeded once from the default sample payload, not kept in sync afterwards —
// this is a form the user can edit locally before each send, exactly like
// FieldMappingModal's formValues.
const payloadText = ref(JSON.stringify(buildTestEventSamplePayload(), null, 2));

const parsedPayload = computed<Record<string, unknown> | null>(() => {
  try {
    const parsed: unknown = JSON.parse(payloadText.value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
});

const payloadError = computed(() =>
  parsedPayload.value ? null : "Payload must be valid JSON object text.",
);

const testResult = computed(() => props.testEventState.result);

// Compact one-line preview of the would-be YAML frontmatter block, so the
// server's frontmatter field (which the response already carries) is
// actually surfaced somewhere rather than sent and never rendered.
const frontmatterPreview = computed(() =>
  testResult.value
    ? JSON.stringify(testResult.value.fieldMapping.frontmatter)
    : "",
);

const SIGNATURE_TONE = {
  not_required: "info",
  verified: "ok",
  failed: "err",
  not_verifiable: "warn",
} as const;

const SIGNATURE_TITLE = {
  not_required: "No signature required",
  // Not "Signature verified" — that would overstate what a self-signed test
  // can prove (see the message body, and the server-side comment on
  // buildSignatureCheck in server/api/sources/[uuid]/test.post.ts).
  verified: "Secret signs correctly",
  failed: "Signature check failed",
  not_verifiable: "Signature check not verifiable",
} as const;

// Falls back rather than rendering an untitled/untoned alert if the server
// ever reports a status this lookup doesn't know about (e.g. a new status
// added server-side before this component is updated for it) — fail
// noticeably, not silently blank.
const signatureTone = computed(() => {
  const status = testResult.value?.signatureCheck.status;
  if (!status) {
    return "info";
  }
  return SIGNATURE_TONE[status] ?? "warn";
});

const signatureTitle = computed(() => {
  const status = testResult.value?.signatureCheck.status;
  if (!status) {
    return "";
  }
  return SIGNATURE_TITLE[status] ?? "Signature check";
});

function handleSend(): void {
  if (props.submitting || !parsedPayload.value) {
    return;
  }
  emit("send", parsedPayload.value);
}

function handleBackdropClick(): void {
  if (props.submitting) {
    return;
  }
  emit("close");
}
</script>
