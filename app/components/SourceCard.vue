<template>
  <div class="card card-pad">
    <div class="row between">
      <div class="row gap-3">
        <span
          v-if="iconLetter"
          :style="{
            width: '40px',
            height: '40px',
            borderRadius: '9px',
            background: 'var(--accent-tint)',
            color: 'var(--accent-700)',
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'var(--mono)',
            fontWeight: 600,
            fontSize: '17px',
            flex: 'none',
          }"
        >
          {{ iconLetter }}
        </span>
        <span
          v-else
          :style="{
            width: '40px',
            height: '40px',
            borderRadius: '9px',
            background: 'var(--accent-tint)',
            color: 'var(--accent-700)',
            display: 'grid',
            placeItems: 'center',
            flex: 'none',
          }"
        >
          <AppIcon :name="iconName" :size="20" />
        </span>
        <div class="col" style="gap: 3px">
          <span class="row gap-2" style="align-items: center">
            <span style="font-weight: 600; font-size: 15px">{{
              displayName
            }}</span>
            <AppChip v-if="viaLabel" style="font-size: 10px; padding: 1px 6px">
              via {{ viaLabel }}
            </AppChip>
          </span>
          <span class="mono faint" style="font-size: 11.5px">{{
            subLabel
          }}</span>
        </div>
      </div>
      <div class="row gap-2" style="align-items: center">
        <AppBadge :tone="activityStatus.tone" dot>
          {{ activityStatus.label }}
        </AppBadge>
        <button
          v-if="isRotatable"
          class="icon-btn"
          title="Rotate secret"
          style="color: var(--ink-3)"
          @click="emit('rotate', source.attributes.uuid)"
        >
          <AppIcon name="refresh" :size="16" />
        </button>
        <button
          class="icon-btn"
          title="Remove source"
          style="color: var(--ink-3)"
          @click="emit('remove', source.attributes.uuid)"
        >
          <AppIcon name="trash" :size="16" />
        </button>
      </div>
    </div>

    <div class="code" style="margin-top: 16px">
      <div class="code-head">
        <span class="lang">{{ endpointLabel }}</span>
        <AppCopyBtn :text="endpointUrl" />
      </div>
      <div
        class="code-body mono"
        style="font-size: 12.5px; word-break: break-all"
      >
        <template v-if="slugFoundInUrl">
          {{ endpointBefore
          }}<span style="color: var(--accent-700)">{{
            source.attributes.endpointSlug
          }}</span
          >{{ endpointAfter }}
        </template>
        <template v-else>{{ endpointUrl }}</template>
      </div>
    </div>

    <div
      v-if="verificationHint"
      class="muted"
      style="font-size: 11px; margin-top: 10px"
    >
      {{ verificationHint }}
    </div>

    <div
      class="row wrap mono gap-6"
      style="font-size: 11.5px; color: var(--ink-3); margin-top: 14px"
    >
      <span v-for="(item, index) in meta" :key="index">{{ item }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  buildEndpointUrl,
  buildSourceMeta,
  sourceActivityStatus,
} from "~/composables/useSources";
import type { SourceResource } from "~/composables/useSources";
import { PROVIDER_SECRET_HINT } from "../utils/providerSecretCopy";
import {
  isRotatableProvider,
  SHARED_SECRET_PROVIDER_IDS,
} from "#shared/utils/webhookSecrets";

const ICON_BY_TYPE: Record<string, string> = {
  webhook: "zap",
  email: "mail",
  stripe: "card",
  github: "github",
  zapier: "zap",
  rss: "hash",
  shortcuts: "plug",
};

const NAME_BY_TYPE: Record<string, string> = {
  webhook: "Webhook endpoint",
  email: "Email-in address",
};

const SUB_BY_TYPE: Record<string, string> = {
  webhook: "POST · any JSON payload",
  email: "forward or send anything",
};

const VIA_BY_TYPE: Record<string, string> = {
  stripe: "webhook",
  github: "webhook",
  zapier: "webhook",
  rss: "poll",
  shortcuts: "webhook",
};

const LABEL_BY_TYPE: Record<string, string> = {
  email: "address",
};

const PRESET_TYPES = new Set([
  "stripe",
  "github",
  "zapier",
  "rss",
  "shortcuts",
]);

const props = defineProps<{
  source: SourceResource;
}>();

const emit = defineEmits<{
  remove: [uuid: string];
  rotate: [uuid: string];
}>();

// Only provider-backed sources have a rotatable secret; a plain webhook or
// email-in source has none, so the action is hidden for them.
const isRotatable = computed(() =>
  isRotatableProvider(props.source.attributes.provider ?? ""),
);

const sourceType = computed(() => props.source.attributes.type);

const iconName = computed(() => ICON_BY_TYPE[sourceType.value] ?? "zap");

const iconLetter = computed(() => {
  if (!PRESET_TYPES.has(sourceType.value)) {
    return null;
  }
  return props.source.attributes.name[0] ?? null;
});

const displayName = computed(
  () => NAME_BY_TYPE[sourceType.value] ?? props.source.attributes.name,
);

const viaLabel = computed(() => VIA_BY_TYPE[sourceType.value] ?? null);

const subLabel = computed(() => {
  const mapped = SUB_BY_TYPE[sourceType.value];
  if (mapped) {
    return mapped;
  }

  if (props.source.attributes.provider) {
    return `maps ${props.source.attributes.provider}`;
  }

  return "";
});

// Only Zapier/Shortcuts get an ongoing hint: their instructions ("add it as a
// header named...") describe the integration's shape, not a specific value,
// so they stay true after the one-time reveal step (AddSourceModal.vue) has
// closed. GitHub's hint ("paste this into...") refers to a value nothing on
// this card can show again, so surfacing it here would just be confusing.
const verificationHint = computed(() => {
  const provider = props.source.attributes.provider ?? "";
  if (!(SHARED_SECRET_PROVIDER_IDS as readonly string[]).includes(provider)) {
    return "";
  }
  return PROVIDER_SECRET_HINT[provider] ?? "";
});

const endpointLabel = computed(
  () => LABEL_BY_TYPE[sourceType.value] ?? "ingest url",
);

const endpointUrl = computed(() =>
  buildEndpointUrl(sourceType.value, props.source.attributes.endpointSlug),
);

const slugIndex = computed(() =>
  endpointUrl.value.indexOf(props.source.attributes.endpointSlug),
);

const slugFoundInUrl = computed(
  () => props.source.attributes.endpointSlug.length > 0 && slugIndex.value >= 0,
);

const endpointBefore = computed(() =>
  endpointUrl.value.slice(0, slugIndex.value),
);

const endpointAfter = computed(() => {
  const slug = props.source.attributes.endpointSlug;
  return endpointUrl.value.slice(slugIndex.value + slug.length);
});

const activityStatus = computed(() =>
  sourceActivityStatus(props.source.attributes),
);

const meta = computed(() => buildSourceMeta(props.source.attributes));
</script>
