import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";

vi.stubGlobal("definePageMeta", vi.fn());

const recordsRef = ref<object[]>([]);
const isLoadingRef = ref(false);
const loadErrorRef = ref<string | null>(null);
const filterRef = ref("all");

const mockLoadRecords = vi.fn();
const mockFetchRecordStats = vi.fn();
const mockTriggerRecordExport = vi.fn();

vi.mock("../../app/composables/useRecords", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../app/composables/useRecords")>();
  return {
    ...actual,
    useRecords: () => ({
      records: recordsRef,
      isLoading: isLoadingRef,
      loadError: loadErrorRef,
      filter: filterRef,
      loadRecords: mockLoadRecords,
    }),
    get fetchRecordStats() {
      return mockFetchRecordStats;
    },
    formatRelativeTime: (isoString: string) => {
      void isoString;
      return "2m ago";
    },
    formatSourceLabel: (source: string | null) =>
      `label:${source ?? "unknown"}`,
    sourceTypeIcon: () => "zap",
    get triggerRecordExportDownload() {
      return mockTriggerRecordExport;
    },
  };
});

const detailRecordRef = ref<object | null>(null);
const detailLoadingRef = ref(false);
const detailErrorRef = ref<string | null>(null);
const mockOpenDetail = vi.fn();
const mockCloseDetail = vi.fn();

vi.mock("../../app/composables/useRecordDetail", () => ({
  useRecordDetail: () => ({
    record: detailRecordRef,
    isLoading: detailLoadingRef,
    loadError: detailErrorRef,
    open: mockOpenDetail,
    close: mockCloseDetail,
  }),
}));

const routeQueryRef = ref<Record<string, string>>({});
vi.stubGlobal("useRoute", () =>
  reactive({
    get query() {
      return routeQueryRef.value;
    },
  }),
);
const mockNavigateTo = vi.fn();
vi.stubGlobal("navigateTo", mockNavigateTo);

import InboxPage from "../../app/pages/inbox.vue";
import { SOURCE_TYPES } from "../../shared/utils/sourceTypes";

const globalConfig = {
  global: {
    stubs: {
      TheAppShell: { template: '<div><slot name="actions" /><slot /></div>' },
      AppAlert: {
        template: '<div class="app-alert" :data-tone="tone"><slot /></div>',
        props: ["tone", "title", "closeable"],
        emits: ["close"],
      },
      AppBtn: {
        template:
          '<button class="app-btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        props: ["variant", "size", "icon", "disabled"],
        emits: ["click"],
      },
      AppIcon: { template: "<span />" },
      AppBadge: {
        template: '<span class="app-badge"><slot /></span>',
        props: ["tone", "dot"],
      },
      InputSegmented: {
        template:
          '<div class="seg" role="radiogroup"><button v-for="option in options" :key="option.value" class="seg-option" :class="{ on: modelValue === option.value }" role="radio" :aria-checked="modelValue === option.value" @click="$emit(\'update:modelValue\', option.value)">{{ option.label }}</button></div>',
        props: ["modelValue", "options"],
        emits: ["update:modelValue"],
      },
      RecordDetailModal: {
        template:
          '<div class="record-detail-modal" @click="$emit(\'close\')" />',
        props: ["record", "isLoading", "loadError"],
        emits: ["close"],
      },
    },
  },
};

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    type: "records" as const,
    id: "uuid-1",
    attributes: {
      uuid: "uuid-1",
      createdAt: "2026-06-27T10:00:00Z",
      userId: "user-1",
      title: "Test Record",
      content: "Content here",
      sourceId: null,
      source: "webhook/github",
      status: "synced",
      filePath: "99-incoming/test.md",
      tags: null,
      frontmatter: null,
      syncedAt: null,
      errorMessage: null,
      ...overrides,
    },
    links: { self: "/api/records/uuid-1" },
  };
}

const defaultStats = { syncedToday: 12, pending: 1, errors: 1, thisMonth: 284 };

describe("inbox page", () => {
  beforeEach(() => {
    recordsRef.value = [];
    isLoadingRef.value = false;
    loadErrorRef.value = null;
    filterRef.value = "all";
    mockLoadRecords.mockReset();
    mockLoadRecords.mockResolvedValue(undefined);
    mockFetchRecordStats.mockReset();
    mockFetchRecordStats.mockResolvedValue(defaultStats);
    mockTriggerRecordExport.mockReset();
    mockTriggerRecordExport.mockResolvedValue({ status: "success" });
    detailRecordRef.value = null;
    detailLoadingRef.value = false;
    detailErrorRef.value = null;
    routeQueryRef.value = {};
    mockOpenDetail.mockReset();
    mockCloseDetail.mockReset();
    mockNavigateTo.mockReset();
  });

  it("renders a filter button for every source type plus all/errors", async () => {
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    const labels = wrapper
      .findAll(".seg-option")
      .map((button) => button.text());
    for (const sourceType of SOURCE_TYPES) {
      expect(labels).toContain(sourceType);
    }
    expect(labels).toContain("all");
    expect(labels).toContain("errors");
    expect(labels).toHaveLength(SOURCE_TYPES.length + 2);
  });

  it.each(SOURCE_TYPES)(
    "selects the %s filter when its button is clicked",
    async (sourceType) => {
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();
      const button = wrapper
        .findAll(".seg-option")
        .find((each) => each.text() === sourceType);
      await button?.trigger("click");
      expect(filterRef.value).toBe(sourceType);
    },
  );

  it("calls loadRecords on mount", async () => {
    mount(InboxPage, globalConfig);
    await flushPromises();
    expect(mockLoadRecords).toHaveBeenCalledOnce();
  });

  it("fetches stats on mount", async () => {
    mount(InboxPage, globalConfig);
    await flushPromises();
    expect(mockFetchRecordStats).toHaveBeenCalledOnce();
  });

  it("matches snapshot in loading state", async () => {
    isLoadingRef.value = true;
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot in empty state", async () => {
    recordsRef.value = [];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot with records", async () => {
    recordsRef.value = [makeRecord(), makeRecord({ title: "Another" })];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot in error state", async () => {
    loadErrorRef.value = "Failed to load records. Please try again.";
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows loading indicator while isLoading is true", async () => {
    isLoadingRef.value = true;
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).toContain("loading records");
  });

  it("shows error alert when loadError is set", async () => {
    loadErrorRef.value = "Failed to load records. Please try again.";
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".app-alert").exists()).toBe(true);
  });

  it("shows empty state when records array is empty", async () => {
    recordsRef.value = [];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).toContain("No records yet");
  });

  it("shows a filter-specific empty state when a source filter matches nothing", async () => {
    recordsRef.value = [];
    filterRef.value = "stripe";
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).toContain("No stripe records");
    expect(wrapper.text()).toContain("Try a different filter.");
  });

  it("shows a filter-specific empty state for the errors filter", async () => {
    recordsRef.value = [];
    filterRef.value = "errors";
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).toContain("No errors records");
    expect(wrapper.text()).toContain("Try a different filter.");
  });

  it("renders a badge for each record", async () => {
    recordsRef.value = [makeRecord(), makeRecord({ title: "Another" })];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.findAll(".app-badge")).toHaveLength(2);
  });

  it("triggers the record export when the export button is clicked", async () => {
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    const exportButton = wrapper
      .findAll(".app-btn")
      .find((button) => button.text() === "export all records");
    await exportButton?.trigger("click");
    expect(mockTriggerRecordExport).toHaveBeenCalledOnce();
  });

  it("shows a truncation warning when the export is capped", async () => {
    mockTriggerRecordExport.mockResolvedValue({ status: "truncated" });
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    const exportButton = wrapper
      .findAll(".app-btn")
      .find((button) => button.text() === "export all records");
    await exportButton?.trigger("click");
    await flushPromises();
    expect(wrapper.find(".app-alert[data-tone='warn']").exists()).toBe(true);
    expect(wrapper.text()).toContain("left out");
  });

  it("shows an error alert when the export fails", async () => {
    mockTriggerRecordExport.mockResolvedValue({ status: "error" });
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    const exportButton = wrapper
      .findAll(".app-btn")
      .find((button) => button.text() === "export all records");
    await exportButton?.trigger("click");
    await flushPromises();
    expect(wrapper.find(".app-alert[data-tone='err']").exists()).toBe(true);
    expect(wrapper.text()).toContain("couldn't be generated");
  });

  it("shows no export alert when the export completes in full", async () => {
    mockTriggerRecordExport.mockResolvedValue({ status: "success" });
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    const exportButton = wrapper
      .findAll(".app-btn")
      .find((button) => button.text() === "export all records");
    await exportButton?.trigger("click");
    await flushPromises();
    expect(wrapper.find(".app-alert[data-tone='warn']").exists()).toBe(false);
    expect(wrapper.find(".app-alert[data-tone='err']").exists()).toBe(false);
  });

  it("shows success toast after sync now when no load error", async () => {
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    await wrapper.find(".app-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".app-alert[data-tone='ok']").exists()).toBe(true);
  });

  it("shows sync error alert when loadRecords sets loadError during sync", async () => {
    mockLoadRecords
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        loadErrorRef.value = "Failed to load records. Please try again.";
      });
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    await wrapper.find(".app-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".app-alert[data-tone='err']").exists()).toBe(true);
  });

  it("does not show success toast when loadError is set after sync", async () => {
    mockLoadRecords
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        loadErrorRef.value = "Failed to load records. Please try again.";
      });
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    await wrapper.find(".app-btn").trigger("click");
    await flushPromises();
    expect(wrapper.find(".app-alert[data-tone='ok']").exists()).toBe(false);
  });

  it("displays em-dash for records with no filePath", async () => {
    recordsRef.value = [makeRecord({ filePath: null })];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.text()).toContain("—");
  });

  it("navigates to the record query param when a row is clicked", async () => {
    recordsRef.value = [makeRecord({ uuid: "row-uuid" })];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    await wrapper.find(".divide-y > .row").trigger("click");
    expect(mockNavigateTo).toHaveBeenCalledWith({
      path: "/inbox",
      query: { record: "row-uuid" },
    });
  });

  it("opens the detail for the record query param on mount", async () => {
    routeQueryRef.value = { record: "query-uuid" };
    mount(InboxPage, globalConfig);
    await flushPromises();
    expect(mockOpenDetail).toHaveBeenCalledWith("query-uuid");
  });

  it("does not open the detail when no record query param is present", async () => {
    mount(InboxPage, globalConfig);
    await flushPromises();
    expect(mockOpenDetail).not.toHaveBeenCalled();
    expect(mockCloseDetail).toHaveBeenCalled();
  });

  it("renders the detail modal when a record query param is present", async () => {
    routeQueryRef.value = { record: "query-uuid" };
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".record-detail-modal").exists()).toBe(true);
  });

  it("does not render the detail modal without a record query param", async () => {
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.find(".record-detail-modal").exists()).toBe(false);
  });

  it("navigates back to /inbox without the record param when closed", async () => {
    routeQueryRef.value = { record: "query-uuid", filter: "errors" };
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    await wrapper.find(".record-detail-modal").trigger("click");
    expect(mockNavigateTo).toHaveBeenCalledWith(
      { path: "/inbox", query: { filter: "errors" } },
      { replace: true },
    );
  });

  it("preserves existing query params when opening a record", async () => {
    routeQueryRef.value = { filter: "errors" };
    recordsRef.value = [makeRecord({ uuid: "row-uuid" })];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    await wrapper.find(".divide-y > .row").trigger("click");
    expect(mockNavigateTo).toHaveBeenCalledWith({
      path: "/inbox",
      query: { filter: "errors", record: "row-uuid" },
    });
  });

  it("opens the detail when the record query param changes after mount", async () => {
    mount(InboxPage, globalConfig);
    await flushPromises();
    expect(mockOpenDetail).not.toHaveBeenCalled();

    routeQueryRef.value = { record: "late-uuid" };
    await flushPromises();
    expect(mockOpenDetail).toHaveBeenCalledWith("late-uuid");
  });

  it("closes the detail when the record query param is cleared after mount", async () => {
    routeQueryRef.value = { record: "query-uuid" };
    mount(InboxPage, globalConfig);
    await flushPromises();
    mockCloseDetail.mockClear();

    routeQueryRef.value = {};
    await flushPromises();
    expect(mockCloseDetail).toHaveBeenCalled();
  });

  it("triggers the detail via keyboard when a row receives Enter", async () => {
    recordsRef.value = [makeRecord({ uuid: "kbd-uuid" })];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    await wrapper.find(".divide-y > .row").trigger("keydown.enter");
    expect(mockNavigateTo).toHaveBeenCalledWith({
      path: "/inbox",
      query: { record: "kbd-uuid" },
    });
  });

  it("triggers the detail via keyboard when a row receives Space", async () => {
    recordsRef.value = [makeRecord({ uuid: "kbd-uuid" })];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    await wrapper.find(".divide-y > .row").trigger("keydown.space");
    expect(mockNavigateTo).toHaveBeenCalledWith({
      path: "/inbox",
      query: { record: "kbd-uuid" },
    });
  });
});
