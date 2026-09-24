<template>
  <TheAppShell
    active="activity"
    crumb="WORKSPACE / DAN'S VAULT"
    title="Activity"
  >
    <template #actions>
      <AppBtn
        size="sm"
        :icon="isExporting ? 'refresh' : 'download'"
        :disabled="isLoading || !!loadError || log.length === 0 || isExporting"
        @click="exportLog"
        >{{ isExporting ? "exporting…" : "export log" }}</AppBtn
      >
    </template>

    <div style="padding: 22px 26px 40px; max-width: 920px">
      <div v-if="exportNotice" style="margin-bottom: 18px">
        <AppAlert
          :tone="exportNotice.tone"
          :title="exportNotice.title"
          :closeable="true"
          @close="exportNotice = null"
        >
          {{ exportNotice.message }}
        </AppAlert>
      </div>

      <div
        v-if="!isLoading && !loadError"
        style="margin-bottom: 18px"
        data-testid="retention-notice"
      >
        <AppAlert tone="info" :title="retentionTitle" :closeable="false">
          {{ retentionMessage }}
        </AppAlert>
      </div>

      <ActivityFilters
        v-model:kind-filter="kindFilter"
        v-model:source-filter="sourceFilter"
        :sources="sources"
        :disabled="isLoading"
      />

      <!-- loading state -->
      <div
        v-if="isLoading"
        class="col"
        style="
          align-items: center;
          padding: 60px 0;
          color: var(--ink-3);
          gap: 12px;
        "
      >
        <AppIcon name="refresh" :size="24" />
        <span class="mono" style="font-size: 13px">loading activity…</span>
      </div>

      <!-- error state -->
      <AppAlert
        v-else-if="loadError"
        tone="err"
        title="Failed to load activity"
        :closeable="false"
      >
        {{ loadError }}
      </AppAlert>

      <!-- empty state -->
      <div
        v-else-if="log.length === 0"
        class="col"
        style="
          align-items: center;
          padding: 60px 0;
          color: var(--ink-3);
          gap: 12px;
          text-align: center;
        "
      >
        <AppIcon name="fileText" :size="32" />
        <span style="font-size: 15px; font-weight: 500; color: var(--ink-2)">{{
          emptyStateTitle
        }}</span>
        <span class="mono" style="font-size: 13px">
          {{ emptyStateHint }}
        </span>
      </div>

      <template v-else>
        <ActivityLogTerminal :log="log" />

        <AppLoadMore
          v-if="hasMore"
          :is-loading="isLoadingMore"
          @load="loadMore"
        />
      </template>
    </div>
  </TheAppShell>
</template>

<script setup lang="ts">
import {
  useEvents,
  triggerExportDownload,
  EVENT_SOURCE_FILTER_ALL,
} from "~/composables/useEvents";
import { useSources } from "~/composables/useSources";
import { useExportNotice } from "~/composables/useExportNotice";
import {
  RETENTION_NOTICE_TITLE,
  retentionNoticeMessage,
} from "#shared/utils/retention";

definePageMeta({ middleware: "auth" });

useHead({ title: "Activity" });

const retentionTitle = RETENTION_NOTICE_TITLE;
const retentionMessage = retentionNoticeMessage();

const {
  log,
  isLoading,
  isLoadingMore,
  loadError,
  hasMore,
  kindFilter,
  sourceFilter,
  loadEvents,
  loadMore,
} = useEvents();

const { sources, loadSources } = useSources();

const hasActiveFilter = computed(
  () =>
    kindFilter.value !== "all" ||
    sourceFilter.value !== EVENT_SOURCE_FILTER_ALL,
);

const emptyStateTitle = computed(() =>
  hasActiveFilter.value ? "No matching activity" : "No activity yet",
);

const emptyStateHint = computed(() =>
  hasActiveFilter.value
    ? "Try a different filter."
    : "Events will appear here once sources start delivering records.",
);

const {
  notice: exportNotice,
  isExporting,
  run: exportLog,
} = useExportNotice(triggerExportDownload);

onMounted(async () => {
  await Promise.all([loadEvents(), loadSources()]);
});
</script>
