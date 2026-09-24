<template>
  <div class="term">
    <div class="term-bar">
      <span class="dots"><i /><i /><i /></span>
      <span class="t-title">markpost sync --watch</span>
      <span class="grow" />
      <span class="t-title" style="margin-left: auto">live</span>
    </div>
    <div class="term-body" style="max-height: 420px; overflow-y: auto">
      <div
        v-for="([time, kind, message], index) in log"
        :key="index"
        style="display: flex; gap: 12px"
      >
        <span class="c-dim" style="flex: none">{{ time }}</span>
        <span :class="KIND_CLASS[kind]" :style="KIND_STYLE[kind]">
          {{ KIND_PREFIX[kind] }}{{ message }}
        </span>
      </div>
      <div style="display: flex; gap: 12px; margin-top: 6px">
        <span class="pr">$</span>
        <span style="border-left: 7px solid var(--accent)">&nbsp;</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EventKind, LogRow } from "~/composables/useEvents";

defineProps<{
  log: LogRow[];
}>();

// Lookup tables rather than a per-row ternary chain — one branch per kind
// instead of three nested conditionals repeated for class, style, and
// prefix, which is what was pushing activity.vue's own template past
// fallow's complexity threshold before this got pulled out.
const KIND_CLASS: Record<EventKind, string> = {
  ok: "c-ok",
  dim: "c-dim",
  warn: "c-warn",
  err: "",
};

const KIND_STYLE: Record<EventKind, Record<string, string>> = {
  ok: {},
  dim: {},
  warn: {},
  err: { color: "var(--err)" },
};

const KIND_PREFIX: Record<EventKind, string> = {
  ok: "✓ ",
  dim: "  ",
  warn: "! ",
  err: "✗ ",
};
</script>
