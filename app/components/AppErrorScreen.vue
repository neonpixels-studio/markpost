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
    <a href="/" style="position: absolute; top: 28px; left: 40px">
      <AppLogo />
    </a>
    <div style="position: relative; text-align: center; max-width: 540px">
      <div
        class="mono"
        :style="`font-size: clamp(80px, 14vw, 150px); font-weight: 600; letter-spacing: -0.04em; line-height: 1; color: transparent; -webkit-text-stroke: 2px ${strokeColor};`"
      >
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
        <div class="code-body mono" style="font-size: 13px">
          <span :style="{ color: 'var(--accent)' }">$</span>
          {{ terminalCommand }}<br />
          <span
            :style="`color: ${terminalOutputColor}; overflow-wrap: anywhere;`"
            >{{ terminalOutput }}</span
          >
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
  }>(),
  {
    seed: 0,
    strokeColor: "var(--accent)",
    terminalOutputColor: "var(--err)",
  },
);
</script>
