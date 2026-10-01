<template>
  <footer
    style="border-top: 1px solid var(--line); padding: 28px 40px; margin-top: 0"
  >
    <div
      class="row between wrap gap-4"
      style="max-width: 1180px; margin: 0 auto"
    >
      <div class="row gap-3">
        <AppLogo :size="18" />
        <span class="mono faint" style="font-size: 12px">© 2026 markpost</span>
      </div>
      <div class="row mono gap-6" style="font-size: 12px; color: var(--ink-3)">
        <NuxtLink to="/pricing" class="footer-link"> pricing </NuxtLink>
        <NuxtLink to="/docs" class="footer-link"> docs </NuxtLink>
        <NuxtLink to="/login" class="footer-link"> sign in </NuxtLink>
        <NuxtLink to="/privacy" class="footer-link"> privacy </NuxtLink>
        <NuxtLink to="/terms" class="footer-link"> terms </NuxtLink>
        <button
          v-if="gaId"
          type="button"
          class="footer-link"
          @click="reopenPrompt"
        >
          cookie settings
        </button>
        <span class="row gap-2">
          <AppBadge tone="ok" dot style="font-size: 10px"
            >all systems go</AppBadge
          >
        </span>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
const gaId = useRuntimeConfig().public.gaId;
const { reopenPrompt } = useAnalyticsConsent();
</script>

<style scoped>
.footer-link {
  background: none;
  border: 0;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 13px;
  padding: 0;
  color: var(--ink-3);
}
</style>
