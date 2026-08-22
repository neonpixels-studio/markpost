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
        <span style="font-size: 15px; font-weight: 500; color: var(--ink-2)"
          >No activity yet</span
        >
        <span class="mono" style="font-size: 13px">
          Events will appear here once sources start delivering records.
        </span>
      </div>

      <!-- log terminal -->
      <div v-else class="term">
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
            <span
              :class="
                kind === 'ok'
                  ? 'c-ok'
                  : kind === 'dim'
                    ? 'c-dim'
                    : kind === 'warn'
                      ? 'c-warn'
                      : ''
              "
              :style="kind === 'err' ? { color: 'var(--err)' } : {}"
            >
              {{
                kind === "err"
                  ? "✗ "
                  : kind === "warn"
                    ? "! "
                    : kind === "ok"
                      ? "✓ "
                      : "  "
              }}{{ message }}
            </span>
          </div>
          <div style="display: flex; gap: 12px; margin-top: 6px">
            <span class="pr">$</span>
            <span style="border-left: 7px solid var(--accent)">&nbsp;</span>
          </div>
        </div>
      </div>
    </div>
  </TheAppShell>
</template>

<script setup lang="ts">
import { useEvents, triggerExportDownload } from "~/composables/useEvents";
import { useExportNotice } from "~/composables/useExportNotice";
import {
  RETENTION_NOTICE_TITLE,
  retentionNoticeMessage,
} from "#shared/utils/retention";

definePageMeta({ middleware: "auth" });

const retentionTitle = RETENTION_NOTICE_TITLE;
const retentionMessage = retentionNoticeMessage();

const { log, isLoading, loadError, loadEvents } = useEvents();

const {
  notice: exportNotice,
  isExporting,
  run: exportLog,
} = useExportNotice(triggerExportDownload);

onMounted(loadEvents);
</script>
