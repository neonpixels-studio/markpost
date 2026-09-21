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
            class="row settings-layout__tab gap-3"
            :style="{
              background:
                activeTab === tab.id ? 'var(--accent-tint)' : 'transparent',
              color:
                activeTab === tab.id ? 'var(--accent-700)' : 'var(--ink-2)',
              fontWeight: activeTab === tab.id ? 600 : 500,
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
  /* Without this, wide unbreakable content (e.g. API tokens in SetTokens,
     code blocks) can force this grid column — and the page — wider than the
     viewport at the phone breakpoint below, where the grid becomes 1fr. */
  min-width: 0;
}

/* Static layout props for each tab button (dynamic active-state props stay
   inline via :style). Kept out of the inline style so the phone rule below
   can override width — an inline style always beats a stylesheet rule of
   any specificity short of !important. */
.settings-layout__tab {
  width: 100%;
  border: 0;
  cursor: pointer;
  padding: 8px 10px;
  border-radius: 7px;
  font-family: var(--mono);
  font-size: 13px;
  white-space: nowrap;
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

  /* Overrides the global .col utility's flex-direction: column. Vue's
     scoped-style attribute selector already gives a single local class here
     more specificity than that global class, but this stays compound to
     match the equivalent (load-bearing, see TheAppShell.vue) pattern used
     for the tab-width override just below. */
  .settings-layout__nav .settings-layout__nav-list {
    flex-direction: row;
  }

  /* Two-class compound selector: enough specificity to beat the base
     .settings-layout__tab rule above regardless of source order (see that
     rule's comment), without an unnecessarily deep selector chain. */
  .settings-layout__nav-list .settings-layout__tab {
    width: auto;
  }

  .settings-layout__body {
    padding: 18px 16px 40px;
  }
}
</style>
