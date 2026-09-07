import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref, computed } from "vue";

vi.stubGlobal("definePageMeta", vi.fn());

type MockRecord = { attributes: { uuid: string } };

const recordsRef = ref<MockRecord[]>([]);
const isLoadingRef = ref(false);
const isLoadingMoreRef = ref(false);
const loadErrorRef = ref<string | null>(null);
const hasMoreRef = ref(false);
const filterRef = ref("all");
const selectedUuidsRef = ref<Set<string>>(new Set());
const isDeletingRef = ref(false);
const isUpdatingStatusRef = ref(false);
const actionErrorRef = ref<string | null>(null);

const mockLoadRecords = vi.fn();
const mockLoadMore = vi.fn();
const mockFetchRecordStats = vi.fn();
const mockTriggerRecordExport = vi.fn();
const mockDeleteRecords = vi.fn();
const mockUpdateRecordsStatus = vi.fn();

function isSelected(uuid: string): boolean {
  return selectedUuidsRef.value.has(uuid);
}

function toggleSelection(uuid: string): void {
  const next = new Set(selectedUuidsRef.value);
  if (next.has(uuid)) {
    next.delete(uuid);
  } else {
    next.add(uuid);
  }
  selectedUuidsRef.value = next;
}

function clearSelection(): void {
  selectedUuidsRef.value = new Set();
}

function visibleUuids(): string[] {
  return recordsRef.value.map((record) => record.attributes.uuid);
}

function toggleSelectAllVisible(): void {
  const uuids = visibleUuids();
  const allSelected =
    uuids.length > 0 && uuids.every((uuid) => selectedUuidsRef.value.has(uuid));
  selectedUuidsRef.value = allSelected ? new Set() : new Set(uuids);
}

vi.mock("../../app/composables/useRecords", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../app/composables/useRecords")>();
  return {
    ...actual,
    useRecords: () => ({
      records: recordsRef,
      isLoading: isLoadingRef,
      isLoadingMore: isLoadingMoreRef,
      loadError: loadErrorRef,
      hasMore: hasMoreRef,
      filter: filterRef,
      loadRecords: mockLoadRecords,
      loadMore: mockLoadMore,
      selectedUuids: selectedUuidsRef,
      selectedCount: computed(() => selectedUuidsRef.value.size),
      isSelected,
      toggleSelection,
      isAllVisibleSelected: computed(() => {
        const uuids = visibleUuids();
        return (
          uuids.length > 0 &&
          uuids.every((uuid) => selectedUuidsRef.value.has(uuid))
        );
      }),
      toggleSelectAllVisible,
      clearSelection,
      isDeleting: isDeletingRef,
      isUpdatingStatus: isUpdatingStatusRef,
      actionError: actionErrorRef,
      deleteRecords: mockDeleteRecords,
      updateRecordsStatus: mockUpdateRecordsStatus,
    }),
    get fetchRecordStats() {
      return mockFetchRecordStats;
    },
    formatRelativeTime: (isoString: string) => {
      void isoString;
      return "2m ago";
    },
    formatSourceLabel: (source: string | null, sourceType: string | null) =>
      `label:${source ?? sourceType ?? "unknown"}`,
    sourceTypeIcon: (sourceType: string | null) =>
      `icon:${sourceType ?? "none"}`,
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
      AppLoadMore: {
        template:
          '<button class="app-btn app-load-more" :disabled="isLoading" @click="$emit(\'load\')">{{ isLoading ? "loading…" : "load more" }}</button>',
        props: ["isLoading"],
        emits: ["load"],
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
      InputCheckbox: {
        template:
          '<input type="checkbox" class="input-checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
        props: ["modelValue"],
        emits: ["update:modelValue"],
      },
      ConfirmDialog: {
        template:
          '<div class="confirm-dialog"><span class="confirm-title">{{ title }}</span><button class="confirm-confirm" @click="$emit(\'confirm\')">{{ confirmLabel }}</button><button class="confirm-cancel" @click="$emit(\'cancel\')">cancel</button></div>',
        props: ["title", "message", "confirmLabel"],
        emits: ["confirm", "cancel"],
      },
      RecordRow: {
        template:
          '<div class="record-row" @click="$emit(\'open\', record.attributes.uuid)"><button class="row-select" @click.stop="$emit(\'toggle-select\', record.attributes.uuid)">{{ selected ? "selected" : "select" }}</button><button class="row-delete" @click.stop="$emit(\'delete\', record.attributes.uuid)">delete</button></div>',
        props: ["record", "selected"],
        emits: ["open", "toggle-select", "delete"],
      },
      RecordBulkActions: {
        template:
          '<div class="record-bulk-actions"><span class="bulk-count">{{ selectedCount }} selected</span><button v-for="status in [\'synced\', \'pending\', \'error\']" :key="status" class="mark-btn" :class="`mark-${status}`" :disabled="disabled" @click="$emit(\'mark-status\', status)">mark {{ status }}</button><button class="delete-selected-btn" :disabled="disabled" @click="$emit(\'delete-selected\')">delete selected</button><button class="clear-btn" @click="$emit(\'clear\')">clear</button></div>',
        props: ["selectedCount", "disabled"],
        emits: ["mark-status", "delete-selected", "clear"],
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
      sourceId: "source-1",
      source: "My GitHub hook",
      sourceType: "github",
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
    isLoadingMoreRef.value = false;
    loadErrorRef.value = null;
    hasMoreRef.value = false;
    filterRef.value = "all";
    mockLoadRecords.mockReset();
    mockLoadRecords.mockResolvedValue(undefined);
    mockLoadMore.mockReset();
    mockLoadMore.mockResolvedValue(undefined);
    mockFetchRecordStats.mockReset();
    mockFetchRecordStats.mockResolvedValue(defaultStats);
    mockTriggerRecordExport.mockReset();
    mockTriggerRecordExport.mockResolvedValue({ status: "success" });
    selectedUuidsRef.value = new Set();
    isDeletingRef.value = false;
    isUpdatingStatusRef.value = false;
    actionErrorRef.value = null;
    mockDeleteRecords.mockReset();
    mockDeleteRecords.mockResolvedValue(1);
    mockUpdateRecordsStatus.mockReset();
    mockUpdateRecordsStatus.mockResolvedValue([]);
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

  it("renders one row per record", async () => {
    recordsRef.value = [makeRecord(), makeRecord({ title: "Another" })];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    expect(wrapper.findAll(".record-row")).toHaveLength(2);
  });

  it("shows the load-more button when more records are available", async () => {
    recordsRef.value = [makeRecord()];
    hasMoreRef.value = true;
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    const loadMoreButton = wrapper
      .findAll(".app-btn")
      .find((button) => button.text() === "load more");
    expect(loadMoreButton).toBeDefined();
  });

  it("hides the load-more button when no more records are available", async () => {
    recordsRef.value = [makeRecord()];
    hasMoreRef.value = false;
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    const loadMoreButton = wrapper
      .findAll(".app-btn")
      .find((button) => button.text() === "load more");
    expect(loadMoreButton).toBeUndefined();
  });

  it("calls loadMore when the load-more button is clicked", async () => {
    recordsRef.value = [makeRecord()];
    hasMoreRef.value = true;
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    const loadMoreButton = wrapper
      .findAll(".app-btn")
      .find((button) => button.text() === "load more");
    await loadMoreButton?.trigger("click");
    expect(mockLoadMore).toHaveBeenCalledOnce();
  });

  it("shows a loading label on the load-more button while fetching more", async () => {
    recordsRef.value = [makeRecord()];
    hasMoreRef.value = true;
    isLoadingMoreRef.value = true;
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    const loadMoreButton = wrapper
      .findAll(".app-btn")
      .find((button) => button.text() === "loading…");
    expect(loadMoreButton).toBeDefined();
    expect(loadMoreButton?.attributes("disabled")).toBeDefined();
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

  it("navigates to the record query param when a row is clicked", async () => {
    recordsRef.value = [makeRecord({ uuid: "row-uuid" })];
    const wrapper = mount(InboxPage, globalConfig);
    await flushPromises();
    await wrapper.find(".record-row").trigger("click");
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
    await wrapper.find(".record-row").trigger("click");
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

  describe("row selection", () => {
    it("toggles a record's selection when its row emits toggle-select, without opening the detail", async () => {
      recordsRef.value = [makeRecord({ uuid: "row-uuid" })];
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();

      await wrapper.find(".row-select").trigger("click");

      expect(selectedUuidsRef.value.has("row-uuid")).toBe(true);
      expect(mockNavigateTo).not.toHaveBeenCalled();
    });

    it("shows the bulk action toolbar once a record is selected", async () => {
      recordsRef.value = [makeRecord({ uuid: "row-uuid" })];
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();

      expect(wrapper.find(".record-bulk-actions").exists()).toBe(false);

      await wrapper.find(".row-select").trigger("click");

      expect(wrapper.find(".bulk-count").text()).toBe("1 selected");
    });

    it("selects every visible record when the header checkbox is checked", async () => {
      recordsRef.value = [
        makeRecord({ uuid: "row-1" }),
        makeRecord({ uuid: "row-2" }),
      ];
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();

      const headerCheckbox = wrapper.find(".input-checkbox");
      await headerCheckbox.setValue(true);

      expect(selectedUuidsRef.value.has("row-1")).toBe(true);
      expect(selectedUuidsRef.value.has("row-2")).toBe(true);
    });

    it("clears the selection when 'clear' is clicked", async () => {
      recordsRef.value = [makeRecord({ uuid: "row-uuid" })];
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();
      await wrapper.find(".row-select").trigger("click");

      await wrapper.find(".clear-btn").trigger("click");

      expect(selectedUuidsRef.value.size).toBe(0);
    });
  });

  describe("bulk status update", () => {
    it("updates the status of every selected record when a 'mark <status>' button is clicked", async () => {
      recordsRef.value = [
        makeRecord({ uuid: "row-1" }),
        makeRecord({ uuid: "row-2" }),
      ];
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();
      const rowSelectButtons = wrapper.findAll(".row-select");
      await rowSelectButtons[0]?.trigger("click");
      await rowSelectButtons[1]?.trigger("click");

      await wrapper.find(".mark-pending").trigger("click");
      await flushPromises();

      expect(mockUpdateRecordsStatus).toHaveBeenCalledWith(
        expect.arrayContaining(["row-1", "row-2"]),
        "pending",
      );
    });

    it("does nothing when a status button is clicked with no selection", async () => {
      recordsRef.value = [makeRecord({ uuid: "row-1" })];
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();

      // No selection made — the toolbar is hidden, so no status button exists.
      expect(wrapper.find(".mark-synced").exists()).toBe(false);
      expect(mockUpdateRecordsStatus).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("opens a confirm dialog for a single record and deletes on confirm", async () => {
      recordsRef.value = [makeRecord({ uuid: "row-uuid" })];
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();

      await wrapper.find(".row-delete").trigger("click");
      await flushPromises();

      expect(mockNavigateTo).not.toHaveBeenCalled();
      expect(wrapper.find(".confirm-dialog").exists()).toBe(true);

      await wrapper.find(".confirm-confirm").trigger("click");
      await flushPromises();

      expect(mockDeleteRecords).toHaveBeenCalledWith(["row-uuid"]);
    });

    it("does not delete when the confirm dialog is cancelled", async () => {
      recordsRef.value = [makeRecord({ uuid: "row-uuid" })];
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();

      await wrapper.find(".row-delete").trigger("click");
      await wrapper.find(".confirm-cancel").trigger("click");
      await flushPromises();

      expect(wrapper.find(".confirm-dialog").exists()).toBe(false);
      expect(mockDeleteRecords).not.toHaveBeenCalled();
    });

    it("deletes every selected record via the bulk delete button", async () => {
      recordsRef.value = [
        makeRecord({ uuid: "row-1" }),
        makeRecord({ uuid: "row-2" }),
      ];
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();
      const rowSelectButtons = wrapper.findAll(".row-select");
      await rowSelectButtons[0]?.trigger("click");
      await rowSelectButtons[1]?.trigger("click");

      await wrapper.find(".delete-selected-btn").trigger("click");
      await wrapper.find(".confirm-confirm").trigger("click");
      await flushPromises();

      expect(mockDeleteRecords).toHaveBeenCalledWith(
        expect.arrayContaining(["row-1", "row-2"]),
      );
    });

    it("shows the action error banner when a bulk action fails", async () => {
      recordsRef.value = [makeRecord({ uuid: "row-uuid" })];
      actionErrorRef.value = "Failed to delete records. Please try again.";
      const wrapper = mount(InboxPage, globalConfig);
      await flushPromises();

      expect(wrapper.text()).toContain(
        "Failed to delete records. Please try again.",
      );
    });
  });
});
