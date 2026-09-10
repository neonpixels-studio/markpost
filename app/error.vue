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
    <AppBtn variant="accent" icon="refresh" @click="handleRetry">
      try again
    </AppBtn>
    <AppBtn icon="arrowR" href="/">back to home</AppBtn>
  </AppErrorScreen>
</template>

<script setup lang="ts">
import type { NuxtError } from "#app";

const props = defineProps<{
  error: NuxtError;
}>();

useHead({ title: "Something went wrong" });

const statusCode = computed(() => props.error.statusCode ?? 500);

// 5xx bodies can carry internal detail (thrown from a DB call, an upstream
// API, etc.) in `message`, so only surface it below 500 where it's routinely
// a client-facing validation message. `statusMessage` is always safe to show.
const isServerError = computed(() => statusCode.value >= 500);

const strokeColor = computed(() =>
  isServerError.value ? "var(--err)" : "var(--accent)",
);

const statusMessage = computed(() => {
  if (isServerError.value) {
    return props.error.statusMessage || "internal error";
  }
  return props.error.statusMessage || props.error.message || "unhandled error";
});

const heading = computed(() =>
  isServerError.value ? "Something went wrong." : "That request didn't work.",
);

const lead = computed(() =>
  isServerError.value
    ? "The sync hit a snag on our end. Try again, or head back home while we look into it."
    : "Check the link and try again, or head back home.",
);

// A full reload re-requests the page that errored, so if the failure was
// transient (a dropped connection, a stale deploy) the user lands back where
// they were instead of being punted home.
function handleRetry() {
  window.location.reload();
}
</script>
