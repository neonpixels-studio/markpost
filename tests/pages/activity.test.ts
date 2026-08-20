import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";

vi.stubGlobal("definePageMeta", vi.fn());
vi.stubGlobal("onMounted", (fn: () => void) => fn());

import type { LogRow } from "../../app/composables/useEvents";

const logRef = ref<LogRow[]>([]);
const isLoadingRef = ref(false);
const loadErrorRef = ref<string | null>(null);

const mockLoadEvents = vi.fn();

const { mockTriggerExportDownload } = vi.hoisted(() => ({
  mockTriggerExportDownload: vi.fn(),
}));

vi.mock("../../app/composables/useEvents", () => ({
  useEvents: () => ({
    log: logRef,
    isLoading: isLoadingRef,
    loadError: loadErrorRef,
    loadEvents: mockLoadEvents,
  }),
  triggerExportDownload: mockTriggerExportDownload,
}));

import ActivityPage from "../../app/pages/activity.vue";

const globalConfig = {
  global: {
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
      AppIcon: { template: "<span />" },
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
    loadErrorRef.value = null;
    mockLoadEvents.mockReset();
    mockLoadEvents.mockResolvedValue(undefined);
    mockTriggerExportDownload.mockReset();
    mockTriggerExportDownload.mockResolvedValue({ status: "success" });
  });

  it("calls loadEvents on mount", async () => {
    mount(ActivityPage, globalConfig);
    await flushPromises();
    expect(mockLoadEvents).toHaveBeenCalledOnce();
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

  it("matches snapshot with events", async () => {
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
});
