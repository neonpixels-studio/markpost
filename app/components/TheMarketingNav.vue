<template>
  <header
    class="row between"
    style="
      padding: 20px 40px;
      border-bottom: 1px solid var(--line);
      position: sticky;
      top: 0;
      background: color-mix(in oklab, var(--bg) 88%, transparent);
      backdrop-filter: blur(8px);
      z-index: 20;
    "
  >
    <NuxtLink
      to="/"
      style="border: 0; background: none; cursor: pointer; padding: 0"
    >
      <AppLogo />
    </NuxtLink>
    <nav class="row mono gap-6" style="font-size: 13px; color: var(--ink-2)">
      <NuxtLink
        to="/pricing"
        :style="{
          background: 'none',
          border: 0,
          cursor: 'pointer',
          color: active === 'pricing' ? 'var(--ink)' : 'var(--ink-2)',
          fontFamily: 'var(--mono)',
          fontSize: '13px',
          padding: 0,
        }"
      >
        pricing
      </NuxtLink>
      <NuxtLink
        to="/docs"
        :style="{
          background: 'none',
          border: 0,
          cursor: 'pointer',
          color: active === 'docs' ? 'var(--ink)' : 'var(--ink-2)',
          fontFamily: 'var(--mono)',
          fontSize: '13px',
          padding: 0,
        }"
      >
        docs
      </NuxtLink>
      <a
        href="https://github.com/neonpixels-studio/markpost"
        style="
          background: none;
          border: 0;
          cursor: pointer;
          color: var(--ink-2);
          font-family: var(--mono);
          font-size: 13px;
          padding: 0;
        "
      >
        github
      </a>
    </nav>
    <div class="row gap-2">
      <AppBtn variant="ghost" size="sm" href="/login">sign in</AppBtn>
      <AppBtn variant="accent" size="sm" icon-r="arrowR" href="/pricing"
        >start free</AppBtn
      >
    </div>
  </header>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    active?: string;
  }>(),
  {
    active: "",
  },
);
</script>
