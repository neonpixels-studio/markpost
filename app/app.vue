<template>
  <NuxtRouteAnnouncer />
  <NuxtPage />
</template>

<script setup lang="ts">
// Every page title carries the product name so agents and search engines can
// identify Markpost from the title alone. Pages set a bare title (e.g. "Docs");
// the template appends the brand. Pages that set none fall back to the default.
useHead({
  titleTemplate: (title) => (title ? `${title} · Markpost` : "Markpost"),
  meta: [
    {
      name: "description",
      content:
        "Markpost catches inbound webhooks and email, converts them to clean Markdown, and syncs them into your Obsidian vault.",
    },
  ],
});

const { initTheme } = useTheme();
onMounted(initTheme);
</script>
