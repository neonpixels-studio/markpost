import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";

vi.stubGlobal("definePageMeta", vi.fn());

import type { LogRow } from "../../app/composables/useEvents";

const logRef = ref<LogRow[]>([]);
const isLoadingRef = ref(false);
const isLoadingMoreRef = ref(false);
const loadErrorRef = ref<string | null>(null);
const hasMoreRef = ref(false);
const kindFilterRef = ref("all");
const sourceFilterRef = ref("all");

const mockLoadEvents = vi.fn();
const mockLoadMore = vi.fn();

const { mockTriggerExportDownload } = vi.hoisted(() => ({
  mockTriggerExportDownload: vi.fn(),
}));

vi.mock("../../app/composables/useEvents", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../app/composables/useEvents")>();
  return {
    ...actual,
    useEvents: () => ({
      log: logRef,
      isLoading: isLoadingRef,
      isLoadingMore: isLoadingMoreRef,
      loadError: loadErrorRef,
      hasMore: hasMoreRef,
      kindFilter: kindFilterRef,
      sourceFilter: sourceFilterRef,
      loadEvents: mockLoadEvents,
      loadMore: mockLoadMore,
    }),
    triggerExportDownload: mockTriggerExportDownload,
  };
});

type MockSource = { attributes: { uuid: string; name: string } };

const sourcesRef = ref<MockSource[]>([]);
const mockLoadSources = vi.fn();

vi.mock("../../app/composables/useSources", () => ({
  useSources: () => ({
    sources: sourcesRef,
    loadSources: mockLoadSources,
  }),
}));

import ActivityPage from "../../app/pages/activity.vue";
import ActivityFilters from "../../app/components/ActivityFilters.vue";
import ActivityLogTerminal from "../../app/components/ActivityLogTerminal.vue";

const globalConfig = {
  global: {
    // ActivityFilters/ActivityLogTerminal are real components (registered,
    // not stubbed) so the page composes with them exactly as it does in the
    // app — they're normally resolved by Nuxt's auto-import, which isn't
    // available under plain vitest, so tests register components a page
    // uses without an explicit import the same way RecordRow.test.ts does
    // for RecordRow's own children.
    components: { ActivityFilters, ActivityLogTerminal },
    stubs: {
      TheAppShell: { template: '<div><slot name="actions" /><slot /></div>' },
      AppAlert: {
        template: '<div class="app-alert" :data-tone="tone"><slot /></div>',
        props: ["tone", "title", "closeable"],
      },
      AppBtn: {
        template:
          '<button class="app-btn" :disabled="disabled || undefined" @click="$emit(\'click\')"><slot /></button>',
        props: ["variant", "size", "icon", "disabled"],
        emits: ["click"],
      },
      AppLoadMore: {
        template:
          '<button class="app-btn app-load-more" :disabled="isLoading" @click="$emit(\'load\')">{{ isLoading ? "loading…" : "load more" }}</button>',
        props: ["isLoading"],
        emits: ["load"],
      },
      AppIcon: { template: "<span />" },
      InputSegmented: {
        template:
          '<div class="seg" role="radiogroup"><button v-for="option in options" :key="option.value" class="seg-option" :class="{ on: modelValue === option.value }" role="radio" :aria-checked="modelValue === option.value" :disabled="disabled" @click="$emit(\'update:modelValue\', option.value)">{{ option.label }}</button></div>',
        props: ["modelValue", "options", "disabled"],
        emits: ["update:modelValue"],
      },
      InputSelect: {
        template:
          '<select class="input-select" :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>',
        props: ["modelValue", "options", "disabled"],
        emits: ["update:modelValue"],
      },
    },
  },
};

const sampleRows: LogRow[] = [
  ["09:41:02", "ok", "webhook github:push → 99-incoming/deploy.md"],
  ["07:48:30", "err", "conflict: file exists, skipped"],
];

describe("activity page", () => {
  beforeEach(() => {
    logRef.value = [];
    isLoadingRef.value = false;
    isLoadingMoreRef.value = false;
    loadErrorRef.value = null;
    hasMoreRef.value = false;
    kindFilterRef.value = "all";
    sourceFilterRef.value = "all";
    mockLoadEvents.mockReset();
    mockLoadEvents.mockResolvedValue(undefined);
    mockLoadMore.mockReset();
    mockLoadMore.mockResolvedValue(undefined);
    mockTriggerExportDownload.mockReset();
    mockTriggerExportDownload.mockResolvedValue({ status: "success" });
    sourcesRef.value = [];
    mockLoadSources.mockReset();
    mockLoadSources.mockResolvedValue(undefined);
  });

  it("calls loadEvents and loadSources on mount", async () => {
    mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(mockLoadEvents).toHaveBeenCalledOnce();
    expect(mockLoadSources).toHaveBeenCalledOnce();
  });

  it("matches snapshot in loading state", async () => {
    isLoadingRef.value = true;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot in error state", async () => {
    loadErrorRef.value = "Failed to load activity. Please try again.";
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot in empty state", async () => {
    logRef.value = [];
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot with events and a load-more control", async () => {
    logRef.value = sampleRows;
    hasMoreRef.value = true;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot with the source filter visible", async () => {
    sourcesRef.value = [
      { attributes: { uuid: "source-1", name: "Prod deploys" } },
    ];
    logRef.value = sampleRows;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows loading indicator while isLoading is true", async () => {
    isLoadingRef.value = true;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).toContain("loading activity");
  });

  it("shows error alert when loadError is set", async () => {
    loadErrorRef.value = "Failed to load activity. Please try again.";
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".app-alert").exists()).toBe(true);
  });

  it("shows empty state when log is empty", async () => {
    logRef.value = [];
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).toContain("No activity yet");
  });

  it("shows a filter-aware empty state message when a filter is active", async () => {
    logRef.value = [];
    kindFilterRef.value = "err";
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).toContain("No matching activity");
    expect(wrapper.text()).toContain("Try a different filter");
  });

  it("does not show empty state when log has rows", async () => {
    logRef.value = sampleRows;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).not.toContain("No activity yet");
  });

  it("calls triggerExportDownload when export button is clicked", async () => {
    logRef.value = sampleRows;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    await wrapper.find(".app-btn").trigger("click");
    expect(mockTriggerExportDownload).toHaveBeenCalledOnce();
  });

  it("shows a truncation warning when the export is capped", async () => {
    mockTriggerExportDownload.mockResolvedValue({ status: "truncated" });
    logRef.value = sampleRows;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    await wrapper.find(".app-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".app-alert[data-tone='warn']").exists()).toBe(true);
    expect(wrapper.text()).toContain("left out");
  });

  it("shows an error alert when the export fails", async () => {
    mockTriggerExportDownload.mockResolvedValue({ status: "error" });
    logRef.value = sampleRows;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    await wrapper.find(".app-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".app-alert[data-tone='err']").exists()).toBe(true);
    expect(wrapper.text()).toContain("couldn't be generated");
  });

  it("shows no export alert when the export completes in full", async () => {
    mockTriggerExportDownload.mockResolvedValue({ status: "success" });
    logRef.value = sampleRows;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    await wrapper.find(".app-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".app-alert[data-tone='warn']").exists()).toBe(false);
    expect(wrapper.find(".app-alert[data-tone='err']").exists()).toBe(false);
  });

  it("does not show terminal when loading", async () => {
    isLoadingRef.value = true;
    logRef.value = sampleRows;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).not.toContain("markpost sync --watch");
  });

  it("does not show terminal when there is an error", async () => {
    loadErrorRef.value = "Failed to load activity. Please try again.";
    logRef.value = sampleRows;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).not.toContain("markpost sync --watch");
  });

  it("disables export button when loading", async () => {
    isLoadingRef.value = true;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".app-btn").attributes("disabled")).toBeDefined();
  });

  it("disables export button when log is empty", async () => {
    logRef.value = [];
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".app-btn").attributes("disabled")).toBeDefined();
  });

  it("enables export button when log has rows and no error", async () => {
    logRef.value = sampleRows;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".app-btn").attributes("disabled")).toBeUndefined();
  });

  it("surfaces the retention window in the empty state", async () => {
    logRef.value = [];
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find("[data-testid='retention-notice']").exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain("90 days");
  });

  it("surfaces the retention window alongside the log", async () => {
    logRef.value = sampleRows;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find("[data-testid='retention-notice']").exists()).toBe(
      true,
    );
  });

  it("hides the retention notice while loading", async () => {
    isLoadingRef.value = true;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find("[data-testid='retention-notice']").exists()).toBe(
      false,
    );
  });

  it("hides the retention notice on load error", async () => {
    loadErrorRef.value = "Failed to load activity. Please try again.";
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find("[data-testid='retention-notice']").exists()).toBe(
      false,
    );
  });

  it("renders a kind filter option for every event kind plus 'all'", async () => {
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    const labels = wrapper
      .findAll("[data-testid='activity-filters'] .seg-option")
      .map((button) => button.text());
    expect(labels).toEqual(["all", "ok", "dim", "warn", "err"]);
  });

  it("updates kindFilter when a kind filter option is clicked", async () => {
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    const errButton = wrapper
      .findAll(".seg-option")
      .find((button) => button.text() === "err");
    await errButton?.trigger("click");
    expect(kindFilterRef.value).toBe("err");
  });

  it("does not render the source filter when there are no sources", async () => {
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".input-select").exists()).toBe(false);
  });

  it("renders a source filter option for every loaded source plus 'all sources'", async () => {
    sourcesRef.value = [
      { attributes: { uuid: "source-1", name: "Prod deploys" } },
      { attributes: { uuid: "source-2", name: "Staging deploys" } },
    ];
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    const labels = wrapper
      .find(".input-select")
      .findAll("option")
      .map((option) => option.text());
    expect(labels).toEqual(["all sources", "Prod deploys", "Staging deploys"]);
  });

  it("updates sourceFilter when a source option is selected", async () => {
    sourcesRef.value = [
      { attributes: { uuid: "source-1", name: "Prod deploys" } },
    ];
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    const select = wrapper.find(".input-select");
    await select.setValue("source-1");
    expect(sourceFilterRef.value).toBe("source-1");
  });

  it("shows the load-more control when hasMore is true", async () => {
    logRef.value = sampleRows;
    hasMoreRef.value = true;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".app-load-more").exists()).toBe(true);
  });

  it("hides the load-more control when hasMore is false", async () => {
    logRef.value = sampleRows;
    hasMoreRef.value = false;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".app-load-more").exists()).toBe(false);
  });

  it("calls loadMore when the load-more control is clicked", async () => {
    logRef.value = sampleRows;
    hasMoreRef.value = true;
    const wrapper = mount(ActivityPage, globalConfig);
    await flushPromises();
    await wrapper.find(".app-load-more").trigger("click");
    expect(mockLoadMore).toHaveBeenCalledOnce();
  });
});
