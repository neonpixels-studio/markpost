<template>
  <AppErrorScreen
    :seed="5"
    :code="statusCode"
    :stroke-color="strokeColor"
    terminal-command="markpost sync"
    :terminal-output="statusMessage"
    :terminal-output-color="strokeColor"
    :heading="heading"
    :lead="lead"
  >
    <AppBtn
      v-if="isServerError"
      variant="accent"
      icon="refresh"
      @click="handleRetry"
    >
      try again
    </AppBtn>
    <AppBtn :variant="isServerError ? '' : 'accent'" icon="arrowR" href="/">
      back to home
    </AppBtn>
  </AppErrorScreen>
</template>

<script setup lang="ts">
import type { NuxtError } from "#app";

const props = defineProps<{
  error: NuxtError;
}>();

const statusCode = computed(() => props.error.statusCode ?? 500);

const isServerError = computed(() => statusCode.value >= 500);

const strokeColor = computed(() =>
  isServerError.value ? "var(--err)" : "var(--accent)",
);

const heading = computed(() =>
  isServerError.value ? "Something went wrong." : "That request didn't work.",
);

useHead({ title: heading });

// Both `error.message` and `error.statusMessage` are free text a server
// route can set to anything (a rethrown driver error, an upstream API's raw
// response), so neither is safe to render for a 5xx. A 4xx is routinely
// thrown by our own route handlers with a deliberate, user-facing
// `statusMessage` (e.g. "Invalid webhook secret"), so that one field is
// trusted below 500 — `message` still isn't.
const statusMessage = computed(() => {
  if (isServerError.value) {
    return "internal error";
  }
  return props.error.statusMessage || "unhandled error";
});

const lead = computed(() =>
  isServerError.value
    ? "The sync hit a snag on our end. Try again, or head back home while we look into it."
    : "Check the link and try again, or head back home.",
);

// A full reload re-requests the page that errored, so if the failure was
// transient (a dropped connection, a stale deploy) the user lands back where
// they were instead of being punted home. Only offered for 5xx: a 4xx will
// reproduce the same error on reload, so the only useful action is leaving.
function handleRetry() {
  window.location.reload();
}
</script>
