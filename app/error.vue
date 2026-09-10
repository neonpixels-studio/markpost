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

// `error.message` can carry internals (a DB driver's connection string, an
// upstream API's raw response) even on a 4xx, e.g. a rethrown $fetch error.
// `statusMessage` is the only field safe to show unfiltered, so it's the
// only one we render.
const statusMessage = computed(() => {
  if (props.error.statusMessage) {
    return props.error.statusMessage;
  }
  return isServerError.value ? "internal error" : "unhandled error";
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
