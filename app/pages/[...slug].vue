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
    <AppTopo :seed="3" />
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
          -webkit-text-stroke: 2px var(--accent);
        "
      >
        404
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
          <span :style="{ color: 'var(--accent)' }">$</span> cat /vault{{
            route.path
          }}<br />
          <span :style="{ color: 'var(--err)' }"
            >cat: no such file or directory</span
          >
        </div>
      </div>
      <h1 class="h1" style="margin-top: 28px">This page never synced.</h1>
      <p class="lead" style="margin-top: 10px">
        The record you're looking for isn't in the vault. It may have been
        moved, deleted, or never written.
      </p>
      <div class="row gap-3" style="justify-content: center; margin-top: 26px">
        <AppBtn variant="accent" icon="arrowR" href="/">back to home</AppBtn>
        <AppBtn icon="book" href="/docs">read the docs</AppBtn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ name: "not-found" });

const route = useRoute();

useHead({ title: "Page not found" });

// Return a real HTTP 404 for unknown paths instead of a soft-200 app shell, so
// agents (and search engines) don't conclude every path exists. No-op on the
// client; only the SSR response carries a status.
const requestEvent = useRequestEvent();
if (requestEvent) {
  setResponseStatus(requestEvent, 404);
}
</script>
