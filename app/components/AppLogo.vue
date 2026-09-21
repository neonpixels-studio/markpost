<template>
  <span class="row gap-2" style="align-items: center">
    <span
      :style="{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '6px',
        background: 'var(--accent)',
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
        boxShadow: '0 2px 8px -2px var(--accent-tint-2)',
      }"
    >
      <AppIcon
        name="hash"
        :size="size * 0.64"
        :stroke-width="2.4"
        :style="{ color: 'var(--on-accent)' }"
      />
    </span>
    <span
      v-if="showWord"
      class="app-logo__wordmark"
      :style="{
        fontWeight: 600,
        fontSize: `${size * 0.82}px`,
        letterSpacing: '-0.03em',
      }"
    >
      {{ word }}
    </span>
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number;
    showWord?: boolean;
    word?: string;
  }>(),
  {
    size: 22,
    showWord: true,
    word: "markpost",
  },
);
</script>
