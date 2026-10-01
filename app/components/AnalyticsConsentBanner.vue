<template>
  <section
    v-if="isVisible"
    class="card row between wrap gap-4"
    role="region"
    aria-label="Analytics consent"
    style="
      position: fixed;
      right: 20px;
      bottom: 20px;
      left: 20px;
      max-width: 560px;
      margin-left: auto;
      padding: 16px 20px;
      z-index: 50;
    "
  >
    <p class="muted" style="margin: 0; font-size: 13.5px; flex: 1 1 240px">
      Allow Google Analytics to measure how the site is used? It stays off
      unless you accept. See the
      <NuxtLink to="/privacy">privacy policy</NuxtLink>.
    </p>
    <div class="row gap-2">
      <AppBtn size="sm" @click="denyConsent">decline</AppBtn>
      <AppBtn size="sm" variant="accent" @click="grantConsent">accept</AppBtn>
    </div>
  </section>
</template>

<script setup lang="ts">
const gaId = useRuntimeConfig().public.gaId;
const { isPromptOpen, grantConsent, denyConsent } = useAnalyticsConsent();

// Nothing to consent to when analytics isn't configured for this deploy.
const isVisible = computed(() => Boolean(gaId) && isPromptOpen.value);
</script>
