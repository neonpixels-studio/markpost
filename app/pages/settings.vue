<template>
  <TheAppShell
    active="settings"
    crumb="WORKSPACE / DAN'S VAULT"
    title="Settings"
  >
    <div class="settings-layout">
      <!-- settings subnav -->
      <div class="settings-layout__nav">
        <div class="col settings-layout__nav-list gap-2">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="row gap-3"
            :style="{
              width: '100%',
              border: 0,
              cursor: 'pointer',
              background:
                activeTab === tab.id ? 'var(--accent-tint)' : 'transparent',
              color:
                activeTab === tab.id ? 'var(--accent-700)' : 'var(--ink-2)',
              padding: '8px 10px',
              borderRadius: '7px',
              fontFamily: 'var(--mono)',
              fontSize: '13px',
              fontWeight: activeTab === tab.id ? 600 : 500,
              whiteSpace: 'nowrap',
            }"
            @click="activeTab = tab.id"
          >
            <AppIcon :name="tab.ic" :size="16" />{{ tab.label }}
          </button>
        </div>
      </div>

      <!-- settings body -->
      <div class="scroll settings-layout__body">
        <SetAccount v-if="activeTab === 'account'" />
        <SetTokens v-else-if="activeTab === 'tokens'" />
        <SetSync v-else-if="activeTab === 'sync'" />
        <SetAppearance v-else-if="activeTab === 'appearance'" />
        <SetBilling v-else-if="activeTab === 'billing'" />
      </div>
    </div>
  </TheAppShell>
</template>

<script setup lang="ts">
import SetAccount from "~/components/settings/SetAccount.vue";
import SetTokens from "~/components/settings/SetTokens.vue";
import SetSync from "~/components/settings/SetSync.vue";
import SetAppearance from "~/components/settings/SetAppearance.vue";
import SetBilling from "~/components/settings/SetBilling.vue";

definePageMeta({ middleware: "auth" });

useHead({ title: "Settings" });

const activeTab = ref("account");

const tabs = [
  { id: "account", ic: "user", label: "Account" },
  { id: "tokens", ic: "key", label: "API Tokens" },
  { id: "sync", ic: "refresh", label: "Sync" },
  { id: "appearance", ic: "sliders", label: "Appearance" },
  { id: "billing", ic: "card", label: "Billing" },
];
</script>

<style scoped>
/* Breakpoints kept in sync with TheAppShell.vue / inbox.vue / sources.vue:
   tablet: max-width 1024px, phone: max-width 640px */

.settings-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100%;
}

.settings-layout__nav {
  border-right: 1px solid var(--line);
  padding: 22px 14px;
  min-width: 0;
}

.settings-layout__body {
  padding: 30px 36px 60px;
  max-width: 720px;
  overflow-y: auto;
}

@media (max-width: 1024px) {
  .settings-layout {
    grid-template-columns: 180px 1fr;
  }
}

@media (max-width: 640px) {
  .settings-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .settings-layout__nav {
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding: 12px;
    overflow-x: auto;
  }

  /* Compound selector so this reliably beats the global .col utility
     (display: flex; flex-direction: column) regardless of stylesheet
     load order, since both are single-class selectors otherwise. */
  .settings-layout__nav .settings-layout__nav-list {
    flex-direction: row;
  }

  .settings-layout__body {
    padding: 18px 16px 40px;
  }
}
</style>
