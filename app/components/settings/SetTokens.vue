<template>
  <div>
    <SetHead
      eyebrow="api · access"
      title="API Tokens"
      desc="Tokens authenticate the markpost CLI and direct API calls. Treat them like passwords — they carry full access to your records."
    />

    <div v-if="revealedToken" style="margin-bottom: 18px">
      <AppAlert
        tone="warn"
        title="Copy your new token now"
        :closeable="true"
        @close="clearRevealedToken"
      >
        For your security it won't be shown again.
        <div class="code" style="margin-top: 10px">
          <div class="code-head">
            <span class="lang">token</span>
            <AppCopyBtn :text="revealedToken" />
          </div>
          <div
            class="code-body mono"
            style="font-size: 12.5px; word-break: break-all"
          >
            {{ revealedToken }}
          </div>
        </div>
        <p style="margin-top: 10px; font-size: 12.5px">
          {{ formatExpiry(revealedTokenExpiresAt) }}
        </p>
      </AppAlert>
    </div>

    <div v-if="loadError" style="margin-bottom: 16px">
      <AppAlert tone="err" title="Load error">
        {{ loadError }}
        <AppBtn
          variant="ghost"
          size="sm"
          style="margin-top: 8px"
          :disabled="isLoading"
          @click="loadTokens"
        >
          retry
        </AppBtn>
      </AppAlert>
    </div>

    <div v-if="mintError" style="margin-bottom: 16px">
      <AppAlert tone="err" title="Failed to generate token">
        {{ mintError }}
      </AppAlert>
    </div>

    <div v-if="revokeError" style="margin-bottom: 16px">
      <AppAlert tone="err" title="Failed to revoke token">
        {{ revokeError }}
      </AppAlert>
    </div>

    <div v-if="isGenerating" class="card card-pad" style="margin-bottom: 16px">
      <div class="col gap-3">
        <label class="col gap-2">
          <span style="font-size: 13px; font-weight: 500">Token name</span>
          <input
            v-model="pendingTokenName"
            class="input"
            placeholder="e.g. obsidian-laptop"
            :disabled="isMinting"
            @keydown.enter="confirmGenerate"
            @keydown.escape="cancelGenerate"
          />
        </label>
        <TokenExpiryFields
          v-model:wants-expiry="wantsExpiry"
          v-model:expiry-days="pendingExpiryDays"
          :disabled="isMinting"
        />
        <TokenScopeFields
          v-model:wants-scopes="wantsScopes"
          v-model:scopes="pendingScopes"
          :disabled="isMinting"
        />
        <div class="row gap-3">
          <AppBtn
            variant="accent"
            size="sm"
            icon="check"
            :disabled="isConfirmGenerateDisabled"
            @click="confirmGenerate"
          >
            {{ isMinting ? "generating…" : "generate" }}
          </AppBtn>
          <AppBtn
            variant="ghost"
            size="sm"
            :disabled="isMinting"
            @click="cancelGenerate"
          >
            cancel
          </AppBtn>
        </div>
      </div>
    </div>

    <div class="row between" style="margin-bottom: 14px">
      <span class="kicker">
        <template v-if="isLoading">loading…</template>
        <template v-else>{{ activeTokenCount }} active tokens</template>
      </span>
      <AppBtn
        size="sm"
        variant="accent"
        icon="plus"
        :disabled="isGenerating || isMinting"
        @click="startGenerate"
        >generate token</AppBtn
      >
    </div>

    <div class="card" style="overflow: hidden">
      <div class="divide-y">
        <div
          v-for="token in tokens"
          :key="token.id"
          class="row between"
          style="padding: 15px 20px; gap: 16px"
        >
          <div class="row gap-3" style="min-width: 0">
            <span
              style="
                width: 34px;
                height: 34px;
                border-radius: 8px;
                border: 1px solid var(--line-2);
                display: grid;
                place-items: center;
                color: var(--ink-2);
                flex: none;
              "
            >
              <AppIcon name="key" :size="16" />
            </span>
            <div class="col" style="gap: 3px; min-width: 0">
              <span style="font-weight: 500; font-size: 14px">{{
                token.name
              }}</span>
              <span class="mono faint" style="font-size: 11.5px">
                {{ token.prefix }}•••••••••••• · created
                {{ formatDate(token.createdAt) }} · used
                {{ formatDate(token.lastUsedAt) }} ·
                {{ formatExpiry(token.expiresAt) }}
              </span>
              <div class="chip-row">
                <AppChip v-if="!token.scopes" accent>full access</AppChip>
                <AppChip v-for="scope in token.scopes" :key="scope">{{
                  scope
                }}</AppChip>
              </div>
            </div>
          </div>
          <button
            class="icon-btn"
            style="color: var(--err)"
            title="revoke"
            :disabled="isRevoking"
            @click="revokeToken(token.id)"
          >
            <AppIcon name="trash" :size="16" />
          </button>
        </div>
      </div>
    </div>

    <h3 class="h3" style="margin-top: 30px">Use it</h3>
    <div class="code" style="margin-top: 14px">
      <div class="code-head">
        <span class="lang">bash</span>
        <AppCopyBtn
          text="curl -H 'Authorization: Bearer mp_live_…' https://ingest.markpost.io/v1/records"
        />
      </div>
      <div class="code-body" style="white-space: pre">
        <span class="c"># authenticate the CLI</span>
        <span class="k">markpost</span> auth
        <span class="s">mp_live_8f2a…</span>

        <span class="c"># or call the API directly</span>
        <span class="k">curl</span> -H
        <span class="s">"Authorization: Bearer mp_live_…"</span> \
        https://ingest.markpost.io/v1/records
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SetHead from "./SetHead.vue";
import TokenExpiryFields from "./TokenExpiryFields.vue";
import TokenScopeFields from "./TokenScopeFields.vue";
import {
  DEFAULT_TOKEN_EXPIRY_DAYS,
  MAX_TOKEN_EXPIRY_DAYS,
  MILLISECONDS_PER_DAY,
  MIN_TOKEN_EXPIRY_DAYS,
  isTokenExpired,
} from "#shared/utils/tokens";
import type { ScopeName } from "#shared/utils/scopes";

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "2-digit",
  year: "numeric",
  timeZone: "UTC",
};

function formatDate(date: Date | null): string {
  if (!date) {
    return "never";
  }
  return date.toLocaleDateString("en-US", DATE_FORMAT_OPTIONS);
}

// Reads Date.now() with no reactive dependency on the clock, so a page left
// open across a token's exact expiry keeps showing "expires in 1 day" until
// something else (loadTokens, a mint/revoke) re-renders this row. Acceptable
// for a settings page — accepted intentionally rather than adding a ticking
// interval for a display-only staleness window measured in days.
function formatExpiry(expiresAt: Date | null): string {
  if (!expiresAt) {
    return "no expiry";
  }

  if (isTokenExpired(expiresAt)) {
    return "expired";
  }

  const millisecondsRemaining = expiresAt.getTime() - Date.now();
  const daysRemaining = Math.ceil(millisecondsRemaining / MILLISECONDS_PER_DAY);
  return daysRemaining === 1
    ? "expires in 1 day"
    : `expires in ${daysRemaining} days`;
}

const {
  tokens,
  isLoading,
  loadError,
  isMinting,
  mintError,
  isRevoking,
  revokeError,
  revealedToken,
  revealedTokenExpiresAt,
  loadTokens,
  mintToken,
  revokeToken,
  clearRevealedToken,
} = useApiTokens();

// Same non-reactive Date.now() caveat as formatExpiry above: this count goes
// stale at the same pace, re-evaluating only when `tokens` changes.
const activeTokenCount = computed(
  () => tokens.value.filter((token) => !isTokenExpired(token.expiresAt)).length,
);

const isGenerating = ref(false);
const pendingTokenName = ref("");
// Opt-out: checked by default with the suggested 90-day lifetime. Users
// uncheck it for a never-expiring token, or raise/lower the day count.
const wantsExpiry = ref(true);
const pendingExpiryDays = ref(DEFAULT_TOKEN_EXPIRY_DAYS);
// Opt-in, unlike expiry: full access (the pre-scoping, still-documented
// default — see server/api/tokens/index.post.ts normalizeScopes) is the
// unsurprising choice for whoever hasn't thought about scoping yet.
const wantsScopes = ref(false);
const pendingScopes = ref<ScopeName[]>([]);

// Whole days only, and only relevant while the expiry checkbox is checked
// (it is by default) — mirrors the bounds server/api/tokens/index.post.ts
// enforces (both read from #shared/utils/tokens) so a bad value, e.g. 0 from
// a cleared TokenExpiryFields input, is caught client-side instead of
// round-tripping to a 422.
const isExpiryDaysValid = computed(
  () =>
    Number.isInteger(pendingExpiryDays.value) &&
    pendingExpiryDays.value >= MIN_TOKEN_EXPIRY_DAYS &&
    pendingExpiryDays.value <= MAX_TOKEN_EXPIRY_DAYS,
);

// A scoped mint requires at least one scope — an empty array would silently
// request full access server-side (normalizeScopes rejects an empty array,
// but so the form doesn't even round-trip a doomed request).
const isScopesValid = computed(
  () => !wantsScopes.value || pendingScopes.value.length > 0,
);

const isConfirmGenerateDisabled = computed(
  () =>
    !pendingTokenName.value.trim() ||
    (wantsExpiry.value && !isExpiryDaysValid.value) ||
    !isScopesValid.value ||
    isMinting.value,
);

function resetGenerateForm() {
  pendingTokenName.value = "";
  wantsExpiry.value = true;
  pendingExpiryDays.value = DEFAULT_TOKEN_EXPIRY_DAYS;
  wantsScopes.value = false;
  pendingScopes.value = [];
}

function startGenerate() {
  isGenerating.value = true;
  resetGenerateForm();
}

function cancelGenerate() {
  isGenerating.value = false;
  resetGenerateForm();
}

async function confirmGenerate() {
  const name = pendingTokenName.value.trim();

  if (!name) {
    return;
  }

  if (wantsExpiry.value && !isExpiryDaysValid.value) {
    return;
  }

  if (!isScopesValid.value) {
    return;
  }

  const expiresInDays = wantsExpiry.value ? pendingExpiryDays.value : undefined;
  const scopes = wantsScopes.value ? pendingScopes.value : undefined;

  await mintToken(name, expiresInDays, scopes);

  if (mintError.value) {
    return;
  }

  isGenerating.value = false;
  resetGenerateForm();
}

onMounted(() => {
  loadTokens();
});
</script>
