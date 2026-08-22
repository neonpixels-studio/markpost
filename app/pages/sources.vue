<template>
  <TheAppShell active="sources" crumb="WORKSPACE / DAN'S VAULT" title="Sources">
    <template #actions>
      <AppBtn variant="accent" size="sm" icon="plus" @click="openModal"
        >add source</AppBtn
      >
    </template>

    <div style="padding: 22px 26px 40px; max-width: 920px">
      <div style="margin-bottom: 18px">
        <AppAlert tone="info" title="How sources work">
          There are only two ways in — a <strong>webhook endpoint</strong> and
          an <strong>email-in address</strong>. Presets like Stripe or GitHub
          are just a webhook with provider field-mapping baked in.
        </AppAlert>
      </div>

      <!-- transient action error banners (add/remove/rotate — do not gate list) -->
      <AppAlert
        v-for="actionError in actionErrors"
        :key="actionError.key"
        tone="err"
        :title="actionError.title"
        :closeable="true"
        style="margin-bottom: 14px"
        @close="actionError.clear()"
      >
        {{ actionError.message }}
      </AppAlert>

      <!-- loading state -->
      <div
        v-if="isLoading"
        class="col"
        style="
          align-items: center;
          padding: 60px 0;
          color: var(--ink-3);
          gap: 12px;
        "
      >
        <AppIcon name="refresh" :size="24" />
        <span class="mono" style="font-size: 13px">loading sources…</span>
      </div>

      <!-- load error state (full-page, non-dismissable) -->
      <AppAlert
        v-else-if="loadError"
        tone="err"
        :title="LOAD_ERROR_TITLE"
        :closeable="false"
        style="margin-bottom: 18px"
      >
        {{ loadError }}
      </AppAlert>

      <!-- sources list -->
      <template v-else>
        <!-- empty state -->
        <div
          v-if="sources.length === 0"
          class="col"
          style="
            align-items: center;
            padding: 60px 0;
            color: var(--ink-3);
            gap: 12px;
            text-align: center;
          "
        >
          <AppIcon name="plug" :size="32" />
          <span style="font-size: 15px; font-weight: 500; color: var(--ink-2)"
            >No sources yet</span
          >
          <span class="mono" style="font-size: 13px">
            Add a webhook or email-in address to start routing records.
          </span>
          <AppBtn
            variant="accent"
            icon="plus"
            style="margin-top: 8px"
            @click="openModal"
          >
            add source
          </AppBtn>
        </div>

        <div v-else class="col gap-4">
          <SourceCard
            v-for="source in sources"
            :key="source.attributes.uuid"
            :source="source"
            @remove="onRemoveRequested"
            @rotate="onRotateRequested"
          />

          <button
            class="card"
            style="
              padding: 20px;
              border: 1px dashed var(--line-2);
              background: transparent;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 10px;
              color: var(--ink-2);
              font-family: var(--mono);
              font-size: 13px;
            "
            @click="openModal"
          >
            <AppIcon name="plus" :size="16" />connect another source
          </button>
        </div>
      </template>
    </div>

    <AddSourceModal
      v-if="modalState"
      :modal-state="modalState"
      :submitting="isAddingSource"
      @close="modalState = null"
      @pick="pickSource"
      @add="addSource"
    />

    <ConfirmDialog
      v-if="pendingRemoveUuid"
      :title="REMOVE_CONFIRM_TITLE"
      :message="REMOVE_CONFIRM_MESSAGE"
      confirm-label="remove"
      @confirm="confirmRemove"
      @cancel="cancelRemove"
    />

    <RotateSecretModal
      v-if="rotateState"
      :rotate-state="rotateState"
      :submitting="isRotatingSecret"
      :error="rotateError"
      @close="closeRotateModal"
      @rotate="rotateSource"
    />
  </TheAppShell>
</template>

<script setup lang="ts">
import { useSources } from "~/composables/useSources";
import {
  isManualSecretProviderId,
  isRotatableProvider,
} from "#shared/utils/webhookSecrets";
import type { RotateState } from "~/types/rotateSecret";

definePageMeta({ middleware: "auth" });

useHead({ title: "Sources" });

const LOAD_ERROR_TITLE = "Failed to load sources";
const REMOVE_CONFIRM_TITLE = "Remove source?";
const REMOVE_CONFIRM_MESSAGE =
  "This will permanently delete the source and its endpoint. Records already ingested are not affected.";

const DEFAULT_ROUTE_FOLDER = "99-incoming/";

interface SourceChoice {
  id: string;
  name: string;
  via?: string;
  map?: string;
  ic?: string;
  secretEntry?: "manual";
}

interface ModalState {
  step: "pick" | "config" | "reveal";
  choice: SourceChoice | null;
  folder: string;
  revealSecret?: string | null;
}

const {
  sources,
  isLoading,
  loadSources,
  removeSource,
  addSource: addSourceToList,
  rotateSecret,
} = useSources();

const modalState = ref<ModalState | null>(null);
const rotateState = ref<RotateState | null>(null);
const pendingRemoveUuid = ref<string | null>(null);
const loadError = ref<string | null>(null);
const addError = ref<string | null>(null);
const removeError = ref<string | null>(null);
const rotateError = ref<string | null>(null);
// Guards against a double-click on "add source" firing two create requests
// (see AddSourceModal's `submitting` prop).
const isAddingSource = ref(false);
// Same guard for rotation (see RotateSecretModal's `submitting` prop).
const isRotatingSecret = ref(false);

// The transient add/remove failures share one dismissible-banner shape. Each is
// cleared when its own action restarts, so both can be visible at once if the
// two actions have each failed; they render through a single list rather than
// two near-identical blocks. (Rotate errors show inside RotateSecretModal
// instead — its scrim would otherwise bury a page-level banner.)
const actionErrors = computed(() =>
  [
    {
      key: "add",
      title: "Failed to add source",
      message: addError.value,
      clear: () => (addError.value = null),
    },
    {
      key: "remove",
      title: "Failed to remove source",
      message: removeError.value,
      clear: () => (removeError.value = null),
    },
  ].filter((actionError) => actionError.message !== null),
);

onMounted(fetchInitialSources);

// ofetch errors carry the request `options` (including the plaintext request
// body) as expandable own-properties, so create/rotate errors that touch a
// secret must log only the message, never the raw error object.
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchInitialSources(): Promise<void> {
  try {
    await loadSources();
  } catch (fetchError) {
    console.error("[sources] fetchInitialSources error:", fetchError);
    loadError.value = "Failed to load sources. Please try again.";
  }
}

const openModal = () => {
  modalState.value = {
    step: "pick",
    choice: null,
    folder: DEFAULT_ROUTE_FOLDER,
  };
};

const pickSource = (choice: SourceChoice) => {
  modalState.value = {
    step: "config",
    choice,
    folder: DEFAULT_ROUTE_FOLDER,
  };
};

const addSource = async (folder: string, providerSecret?: string) => {
  if (!modalState.value?.choice || isAddingSource.value) {
    return;
  }

  const choice = modalState.value.choice;
  addError.value = null;
  isAddingSource.value = true;

  try {
    const created = await addSourceToList({
      type: choice.id,
      name: choice.name,
      routeFolder: folder,
      providerSecret,
    });
    showRevealStepIfSecretGenerated(choice, created.attributes.providerSecret);
  } catch (createError) {
    console.error("[sources] addSource error:", toErrorMessage(createError));
    addError.value = "Failed to add source. Please try again.";
  } finally {
    isAddingSource.value = false;
  }
};

// GitHub/Zapier/Shortcuts presets get a secret generated by the server, which
// the user needs to paste into that provider's own settings; the server
// reveals it exactly once, in the create response (see
// server/utils/response.ts), so this is the only chance to show it. Stripe's
// secret was just typed in by the user themselves (see AddSourceModal's
// `secretEntry: "manual"`), so there's nothing new to show back. Presets with
// nothing to reveal close the modal as before.
function showRevealStepIfSecretGenerated(
  choice: SourceChoice,
  providerSecret: string | null | undefined,
): void {
  if (!providerSecret || choice.secretEntry === "manual") {
    modalState.value = null;
    return;
  }

  modalState.value = {
    step: "reveal",
    choice,
    folder: DEFAULT_ROUTE_FOLDER,
    revealSecret: providerSecret,
  };
}

const onRotateRequested = (uuid: string) => {
  const source = sources.value.find(
    (candidate) => candidate.attributes.uuid === uuid,
  );
  const provider = source?.attributes.provider;
  // Mirrors SourceCard's own gate: only a known rotatable provider gets a
  // modal, so an unknown provider string can't open a flow the server rejects.
  if (!provider || !isRotatableProvider(provider)) {
    return;
  }

  rotateError.value = null;
  rotateState.value = {
    step: "confirm",
    source: { uuid, provider, name: source.attributes.name },
  };
};

// Ignored while a rotation is in flight: the server may already have rotated,
// so tearing the modal down here would drop the unrevealed new secret and
// leave the source unrecoverable (RotateSecretModal also suppresses its own
// close affordances while submitting — this is the belt-and-braces guard).
const closeRotateModal = () => {
  if (isRotatingSecret.value) {
    return;
  }
  rotateState.value = null;
  rotateError.value = null;
};

const rotateSource = async (providerSecret?: string) => {
  if (!rotateState.value || isRotatingSecret.value) {
    return;
  }

  const { source } = rotateState.value;
  rotateError.value = null;
  isRotatingSecret.value = true;

  try {
    const rotated = await rotateSecret(source.uuid, providerSecret);
    showRotateResult(source.uuid, rotated.attributes.providerSecret);
  } catch (rotationError) {
    // Log only the message: the raw ofetch error carries `options.body`, which
    // on the manual-secret path is the plaintext secret the user just pasted —
    // logging the whole object would expose it in devtools and error reporters.
    console.error(
      "[sources] rotateSource error:",
      toErrorMessage(rotationError),
    );
    // Leave the modal open on its confirm step (mirrors addSource's failure
    // handling) so a manual-secret provider keeps the value the user pasted;
    // RotateSecretModal shows this error inline so they can retry.
    rotateError.value = "Failed to rotate secret. Please try again.";
  } finally {
    isRotatingSecret.value = false;
  }
};

// Generated-secret providers (github/zapier/shortcuts) get a fresh secret back
// to reveal exactly once; manual-secret providers (stripe) supplied their own
// value, so there is nothing new to show — just confirm it took effect. Keying
// the step on the provider (not merely on whether a secret came back) fails
// loud: if a generated provider's one-time secret is ever missing from the
// response, the rotation already happened server-side, so keep the modal on its
// confirm step with an error rather than a false "updated" that hides an
// unrecoverable, now-401ing secret.
function showRotateResult(
  expectedUuid: string,
  revealSecret: string | null | undefined,
): void {
  // The flow may have been retargeted to another source mid-request; only act
  // when the modal still holds the source this result belongs to, so we never
  // show source A's secret under source B's name.
  if (!rotateState.value || rotateState.value.source.uuid !== expectedUuid) {
    return;
  }

  const expectsReveal = !isManualSecretProviderId(
    rotateState.value.source.provider,
  );

  if (expectsReveal && !revealSecret) {
    rotateError.value =
      "The secret was rotated but its new value was not returned. Rotate again to get a usable secret.";
    return;
  }

  rotateState.value = {
    ...rotateState.value,
    step: expectsReveal ? "reveal" : "done",
    // Never park the manual provider's echoed-back secret in reactive state:
    // the done step renders no reveal panel, so it would only sit exposed to
    // devtools/state serializers for no benefit.
    revealSecret: expectsReveal ? (revealSecret ?? null) : null,
  };
}

const onRemoveRequested = (uuid: string) => {
  pendingRemoveUuid.value = uuid;
};

const confirmRemove = async () => {
  if (!pendingRemoveUuid.value) {
    return;
  }

  const uuid = pendingRemoveUuid.value;
  pendingRemoveUuid.value = null;
  removeError.value = null;

  try {
    await removeSource(uuid);
  } catch (deleteError) {
    console.error("[sources] confirmRemove error:", deleteError);
    removeError.value = "Failed to remove source. Please try again.";
  }
};

const cancelRemove = () => {
  pendingRemoveUuid.value = null;
};
</script>
