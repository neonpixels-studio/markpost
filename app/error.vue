<template>
  <div
    style="
      position: relative;
      height: 100vh;
      background: var(--bg);
      display: grid;
      place-items: center;
      overflow: hidden;
      padding: 40px;
    "
  >
    <AppTopo :seed="5" />
    <NuxtLink to="/" style="position: absolute; top: 28px; left: 40px">
      <AppLogo />
    </NuxtLink>
    <div style="position: relative; text-align: center; max-width: 540px">
      <div
        class="mono"
        style="
          font-size: clamp(80px, 14vw, 150px);
          font-weight: 600;
          letter-spacing: -0.04em;
          line-height: 1;
          color: transparent;
          -webkit-text-stroke: 2px var(--err);
        "
      >
        {{ statusCode }}
      </div>
      <div
        class="code"
        style="max-width: 440px; margin: 26px auto 0; text-align: left"
      >
        <div class="code-head">
          <span class="lang">terminal</span>
          <span class="mono faint" style="font-size: 11px">exit 1</span>
        </div>
        <div class="code-body mono" style="font-size: 13px">
          <span :style="{ color: 'var(--accent)' }">$</span> markpost sync<br />
          <span :style="{ color: 'var(--err)' }">{{ statusMessage }}</span>
        </div>
      </div>
      <h1 class="h1" style="margin-top: 28px">Something went wrong.</h1>
      <p class="lead" style="margin-top: 10px">
        The sync hit a snag on our end. Try again, or head back home while we
        look into it.
      </p>
      <div class="row gap-3" style="justify-content: center; margin-top: 26px">
        <AppBtn variant="accent" icon="refresh" @click="handleRetry">
          try again
        </AppBtn>
        <AppBtn icon="arrowR" href="/">back to home</AppBtn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NuxtError } from "#app";

const props = defineProps<{
  error: NuxtError;
}>();

useHead({ title: "Something went wrong" });

const statusCode = computed(() => props.error.statusCode ?? 500);

const statusMessage = computed(() => {
  const message = props.error.statusMessage || props.error.message;
  if (!message) {
    return "unhandled error";
  }
  return message;
});

function handleRetry() {
  clearError({ redirect: "/" });
}
</script>
