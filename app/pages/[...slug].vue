<template>
  <AppErrorScreen
    :seed="3"
    code="404"
    :terminal-command="`cat /vault${route.path}`"
    terminal-output="cat: no such file or directory"
    heading="This page never synced."
    lead="The record you're looking for isn't in the vault. It may have been moved, deleted, or never written."
  >
    <AppBtn variant="accent" icon="arrowR" href="/">back to home</AppBtn>
    <AppBtn icon="book" href="/docs">read the docs</AppBtn>
  </AppErrorScreen>
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
