<template>
  <div class="app-shell">
    <!-- sidebar -->
    <aside class="app-shell__sidebar">
      <NuxtLink to="/" class="app-shell__logo-link">
        <AppLogo :size="22" />
      </NuxtLink>

      <nav class="col app-shell__nav gap-2">
        <span class="kicker app-shell__label" style="padding: 4px 8px 8px"
          >workspace</span
        >
        <NuxtLink
          v-for="navItem in navItems"
          :key="navItem.id"
          :to="navItem.path"
          class="row app-shell__nav-link gap-3"
          :style="{
            width: '100%',
            border: 0,
            cursor: 'pointer',
            background:
              active === navItem.id ? 'var(--accent-tint)' : 'transparent',
            color: active === navItem.id ? 'var(--accent-700)' : 'var(--ink-2)',
            padding: '9px 10px',
            borderRadius: '7px',
            fontFamily: 'var(--mono)',
            fontSize: '13.5px',
            fontWeight: active === navItem.id ? 600 : 500,
            transition: 'all .12s',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }"
        >
          <AppIcon :name="navItem.ic" :size="17" />
          <span class="app-shell__nav-label">{{ navItem.label }}</span>
          <AppBadge
            v-if="navItem.id === 'inbox' && pendingCount"
            tone="accent"
            class="app-shell__nav-badge"
            style="margin-left: auto; font-size: 9.5px; padding: 1px 6px"
          >
            {{ pendingCount }}
          </AppBadge>
        </NuxtLink>

        <div class="app-shell__divider" style="margin-top: 18px">
          <hr class="hairline" />
        </div>

        <a
          href="/docs"
          class="row app-shell__nav-link app-shell__docs-link gap-3"
          style="
            width: 100%;
            border: 0;
            cursor: pointer;
            background: transparent;
            color: var(--ink-2);
            padding: 9px 10px;
            border-radius: 7px;
            font-family: var(--mono);
            font-size: 13.5px;
            margin-top: 6px;
            display: flex;
            align-items: center;
            gap: 12px;
          "
        >
          <AppIcon name="book" :size="17" />
          <span class="app-shell__nav-label">Docs</span>
          <AppIcon
            name="external"
            :size="13"
            class="app-shell__nav-decoration"
            :style="{ marginLeft: 'auto', color: 'var(--ink-3)' }"
          />
        </a>
      </nav>

      <!-- plan card -->
      <div class="app-shell__plan-card">
        <AppPlanCard
          :badge="planBadge"
          :trial-days-left="trialDaysLeft"
          :trial-percent-elapsed="trialPercentElapsed"
        />
      </div>

      <!-- user -->
      <NuxtLink
        to="/settings"
        class="row app-shell__nav-link gap-3"
        style="
          width: 100%;
          border: 1px solid var(--line);
          cursor: pointer;
          background: var(--surface-2);
          padding: 8px 10px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          gap: 12px;
        "
      >
        <span
          style="
            width: 28px;
            height: 28px;
            border-radius: 7px;
            background: var(--accent-tint);
            color: var(--accent-700);
            display: grid;
            place-items: center;
            font-family: var(--mono);
            font-size: 13px;
            font-weight: 600;
            flex: none;
          "
        >
          {{ userInitial }}
        </span>
        <span
          class="col app-shell__nav-label"
          style="align-items: flex-start; line-height: 1.2; overflow: hidden"
        >
          <span style="font-size: 13px; font-weight: 500">{{ userName }}</span>
          <span
            class="mono faint"
            style="
              font-size: 10.5px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              max-width: 130px;
            "
          >
            {{ userEmail }}
          </span>
        </span>
        <AppIcon
          name="chevR"
          :size="14"
          class="app-shell__nav-decoration"
          :style="{ marginLeft: 'auto', color: 'var(--ink-3)' }"
        />
      </NuxtLink>
    </aside>

    <!-- main -->
    <div style="display: flex; flex-direction: column; min-width: 0">
      <header class="row between app-shell__header">
        <div class="col app-shell__title-group">
          <span
            v-if="crumb"
            class="mono faint app-shell__crumb"
            style="font-size: 11px; letter-spacing: 0.08em; white-space: nowrap"
          >
            {{ crumb }}
          </span>
          <h1
            class="app-shell__title"
            style="
              font-size: 17px;
              font-weight: 600;
              letter-spacing: -0.02em;
              white-space: nowrap;
            "
          >
            {{ title }}
          </h1>
        </div>
        <div class="row app-shell__header-actions gap-3">
          <AppRecordSearch ref="recordSearchRef" @select="selectRecord" />
          <slot name="actions" />
          <button
            class="icon-btn"
            style="
              border: 1px solid var(--line);
              border-radius: 7px;
              width: 36px;
              height: 36px;
              justify-content: center;
              color: var(--ink-2);
            "
            title="toggle theme"
            @click="toggleTheme"
          >
            <AppIcon :name="isDark ? 'sun' : 'moon'" :size="17" />
          </button>
          <button
            class="icon-btn"
            style="
              border: 1px solid var(--line);
              border-radius: 7px;
              width: 36px;
              height: 36px;
              justify-content: center;
              color: var(--ink-2);
            "
            title="view activity"
            @click="goToActivity"
          >
            <AppIcon name="bell" :size="17" />
          </button>
        </div>
      </header>
      <div class="scroll" style="overflow-y: auto; flex: 1">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  fetchRecordStats,
  type RecordResource,
} from "~/composables/useRecords";
import {
  fetchBillingUsage,
  derivePlanBadge,
  type BillingUsage,
} from "~/composables/useBillingUsage";

defineProps<{
  active: string;
  title: string;
  crumb?: string;
}>();

const { isDark, initTheme, toggleTheme } = useTheme();
onMounted(initTheme);

const { user } = useUser();

function formatUserName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  if (!first) {
    return "User";
  }
  const initial = last?.[0];
  return initial ? `${first} ${initial}.` : first;
}

const userName = computed(() =>
  formatUserName(user.value?.firstName, user.value?.lastName),
);

const userEmail = computed(
  () => user.value?.primaryEmailAddress?.emailAddress ?? "user@markpost.io",
);

const userInitial = computed(() => userName.value[0]?.toUpperCase() ?? "U");

const navItems = [
  { id: "inbox", ic: "inbox", label: "Inbox", path: "/inbox" },
  { id: "sources", ic: "plug", label: "Sources", path: "/sources" },
  { id: "activity", ic: "activity", label: "Activity", path: "/activity" },
  { id: "settings", ic: "sliders", label: "Settings", path: "/settings" },
];

// ── Inbox nav badge: pending/unsynced record count ──────────────────────────
const pendingCount = ref<number | null>(null);

async function loadPendingCount(): Promise<void> {
  const stats = await fetchRecordStats();
  pendingCount.value = stats?.pending ?? null;
}

// ── Plan card: billing usage & trial status ─────────────────────────────────
const billingUsage = ref<BillingUsage | null>(null);

async function loadBillingUsage(): Promise<void> {
  billingUsage.value = await fetchBillingUsage();
}

const planBadge = computed(() =>
  derivePlanBadge(
    billingUsage.value?.plan ?? "hobby",
    billingUsage.value?.status ?? "active",
  ),
);

const trialDaysLeft = computed(() => billingUsage.value?.trialDaysLeft ?? null);
const trialPercentElapsed = computed(
  () => billingUsage.value?.trialPercentElapsed ?? null,
);

onMounted(() => {
  void loadPendingCount();
  void loadBillingUsage();
});

// ── Header search: focus on ⌘K, navigate to the selected record ────────────
type RecordSearchHandle = { focus: () => void };
const recordSearchRef = ref<RecordSearchHandle | null>(null);

function selectRecord(record: RecordResource): void {
  navigateTo(`/inbox?record=${record.attributes.uuid}`);
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  const isSearchShortcut =
    (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
  if (!isSearchShortcut) {
    return;
  }
  event.preventDefault();
  recordSearchRef.value?.focus();
}

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
});

// ── Notifications bell: link to the activity feed ───────────────────────────
function goToActivity(): void {
  navigateTo("/activity");
}
</script>

<style scoped>
/* ----------------------------------------------------------------------
   Responsive breakpoints — kept in sync with the same values used in
   app/pages/settings.vue, app/pages/inbox.vue and app/pages/sources.vue:
     tablet: max-width 1024px
     phone:  max-width 640px
   ---------------------------------------------------------------------- */

.app-shell {
  height: 100vh;
  display: grid;
  grid-template-columns: 232px 1fr;
  background: var(--bg);
}

.app-shell__sidebar {
  border-right: 1px solid var(--line);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  padding: 18px 14px;
  min-width: 0;
}

.app-shell__logo-link {
  padding: 4px 8px;
  margin-bottom: 18px;
  display: block;
}

/* Static layout props for the nav (dynamic per-item props stay inline on
   each NuxtLink). Kept out of an inline style on <nav> itself so the phone
   override below can win — an inline style always beats a stylesheet rule
   of any specificity short of !important. */
.app-shell__nav {
  flex: 1;
}

.app-shell__header {
  padding: 0 26px;
  height: 60px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in oklab, var(--bg) 84%, transparent);
  backdrop-filter: blur(8px);
  flex: none;
}

/* Fully class-based (no inline style on the element) for the same reason as
   .app-shell__nav above: the phone rule needs to change `flex`. */
.app-shell__title-group {
  gap: 2px;
  flex: none;
  min-width: 0;
}

/* Visually hides text while keeping it in the accessibility tree, so the
   icon-only rail/bar at compact widths still exposes an accessible name for
   each nav link (screen readers) instead of losing it via display: none. */
.app-shell__label,
.app-shell__nav-label,
.app-shell__nav-badge {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 1024px) {
  .app-shell {
    grid-template-columns: 76px 1fr;
  }

  .app-shell__sidebar {
    padding: 18px 10px;
    align-items: center;
  }

  /* Collapse the sidebar to an icon rail: visually hide labels/text (kept
     for screen readers, see .app-shell__nav-label above), drop the plan
     card (promotional, not core navigation) and purely decorative icons
     that have no room in the rail. */
  .app-shell__plan-card,
  .app-shell__nav-decoration {
    display: none;
  }

  .app-shell__nav-link {
    justify-content: center;
  }

  /* AppLogo renders an icon mark plus a text wordmark; the wordmark doesn't
     fit the 56px rail content width, so hide it and keep the mark only. */
  .app-shell__logo-link :deep(.row.gap-2 span:nth-child(2)) {
    display: none;
  }
}

@media (max-width: 640px) {
  .app-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    height: 100dvh;
  }

  /* Sidebar becomes a horizontally-scrollable top bar instead of a rail, so
     the full nav (including Docs) is still reachable on narrow phones
     without vertical space loss. */
  .app-shell__sidebar {
    flex-direction: row;
    align-items: center;
    padding: 10px 12px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .app-shell__logo-link {
    margin-bottom: 0;
  }

  /* Compound selector so this reliably beats the global .col utility
     (display: flex; flex-direction: column) regardless of stylesheet
     load order, since both are single-class selectors otherwise. */
  .app-shell__sidebar .app-shell__nav {
    flex-direction: row;
    flex: none;
  }

  .app-shell__divider {
    display: none;
  }

  .app-shell__header {
    height: auto;
    min-height: 56px;
    padding: 10px 14px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .app-shell__title-group {
    flex: 1 1 auto;
  }

  .app-shell__crumb,
  .app-shell__title {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .app-shell__header-actions {
    flex-wrap: wrap;
  }
}
</style>
