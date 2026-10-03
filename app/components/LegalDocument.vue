<template>
  <div
    class="scroll"
    style="height: 100vh; overflow-y: auto; background: var(--bg)"
  >
    <TheMarketingNav />
    <main style="max-width: 760px; margin: 0 auto; padding: 56px 40px 72px">
      <AppEyebrow>{{ eyebrow }}</AppEyebrow>
      <h1
        class="h1"
        style="margin-top: 16px; font-size: clamp(30px, 4vw, 42px)"
      >
        {{ title }}
      </h1>
      <p class="mono faint" style="margin-top: 10px; font-size: 12px">
        Last updated {{ updated }}
      </p>
      <div class="col gap-4" style="margin-top: 32px; line-height: 1.6">
        <slot />
      </div>
    </main>
    <TheMarketingFooter />
  </div>
</template>

<script setup lang="ts">
defineProps<{ eyebrow: string; title: string; updated: string }>();
</script>
