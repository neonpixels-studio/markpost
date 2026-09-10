<template>
  <div
    style="
      position: relative;
      min-height: 100vh;
      background: var(--bg);
      display: grid;
      place-items: center;
      overflow-y: auto;
      padding: 40px;
    "
  >
    <AppTopo :seed="seed" />
    <NuxtLink
      to="/"
      :external="homeExternal"
      style="position: absolute; top: 28px; left: 40px"
    >
      <AppLogo />
    </NuxtLink>
    <div style="position: relative; text-align: center; max-width: 540px">
      <div class="mono err-glyph" :style="{ '--stroke-color': strokeColor }">
        {{ code }}
      </div>
      <div
        class="code"
        style="max-width: 440px; margin: 26px auto 0; text-align: left"
      >
        <div class="code-head">
          <span class="lang">terminal</span>
          <span class="mono faint" style="font-size: 11px">exit 1</span>
        </div>
        <div
          class="code-body mono"
          :style="{ fontSize: '13px', overflowWrap: 'anywhere' }"
        >
          <span :style="{ color: 'var(--accent)' }">$</span>
          {{ terminalCommand }}<br />
          <span :style="{ color: terminalOutputColor }">{{
            terminalOutput
          }}</span>
        </div>
      </div>
      <h1 class="h1" style="margin-top: 28px">{{ heading }}</h1>
      <p class="lead" style="margin-top: 10px">{{ lead }}</p>
      <div class="row gap-3" style="justify-content: center; margin-top: 26px">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Shared visual shell for the app's full-screen error states (404 and the
// runtime error boundary). Keeping the terminal-card layout in one place
// means a design tweak only has to happen once.
withDefaults(
  defineProps<{
    seed?: number;
    code: string | number;
    strokeColor?: string;
    terminalCommand: string;
    terminalOutput: string;
    terminalOutputColor?: string;
    heading: string;
    lead: string;
    // The runtime error boundary (error.vue) needs the logo link to force a
    // full page load so Nuxt's error state actually clears; a client-side
    // NuxtLink nav changes the URL but leaves the error rendered. The 404
    // page has no such state to clear, so it keeps normal client-side nav.
    homeExternal?: boolean;
  }>(),
  {
    seed: 0,
    strokeColor: "var(--accent)",
    terminalOutputColor: "var(--err)",
    homeExternal: false,
  },
);
</script>
