import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";

import RecordDetailModal from "../../app/components/RecordDetailModal.vue";

// makeRecord() stamps createdAt at 2026-06-27T10:00:00Z; freezing "now" here
// keeps formatRelativeTime()'s output ("35d ago") deterministic so the snapshot
// can't drift by a day against the real clock.
const FROZEN_NOW = "2026-08-01T10:00:00Z";

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    type: "records" as const,
    id: "uuid-1",
    attributes: {
      uuid: "uuid-1",
      createdAt: "2026-06-27T10:00:00Z",
      userId: "user-1",
      title: "Test Record",
      content: "# Heading\n\nBody",
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

const stubs = {
  AppBtn: {
    template:
      '<button class="app-btn" @click="$emit(\'click\')"><slot /></button>',
    props: ["variant", "size", "icon"],
    emits: ["click"],
  },
  AppIcon: { template: '<span :data-icon="name" />', props: ["name", "size"] },
  AppBadge: {
    template: '<span class="app-badge"><slot /></span>',
    props: ["tone", "dot"],
  },
  AppAlert: {
    template: '<div class="app-alert" :data-tone="tone"><slot /></div>',
    props: ["tone", "title", "closeable"],
    emits: ["close"],
  },
  AppCodeBlock: {
    template: '<div class="app-code-block"><slot /></div>',
    props: ["lang", "copy"],
  },
};

function mountModal(props: Record<string, unknown> = {}) {
  return mount(RecordDetailModal, {
    props: {
      record: makeRecord(),
      isLoading: false,
      loadError: null,
      ...props,
    },
    global: { stubs },
  });
}

describe("RecordDetailModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the record title and content", () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain("Test Record");
    expect(wrapper.find(".app-code-block").text()).toContain("Heading");
  });

  it("resolves the source icon from the real type and labels with the source name", () => {
    const wrapper = mountModal();
    expect(wrapper.find("[data-icon]").attributes("data-icon")).toBe("github");
    expect(wrapper.text()).toContain("My GitHub hook");
  });

  it("falls back to the zap icon and stored name when the source type is unresolved", () => {
    const wrapper = mountModal({
      record: makeRecord({ sourceType: null, source: "Legacy hook" }),
    });
    expect(wrapper.find("[data-icon]").attributes("data-icon")).toBe("zap");
    expect(wrapper.text()).toContain("Legacy hook");
  });

  it("shows a loading indicator while loading", () => {
    const wrapper = mountModal({ record: null, isLoading: true });
    expect(wrapper.text()).toContain("loading record");
  });

  it("shows an error alert when loadError is set", () => {
    const wrapper = mountModal({
      record: null,
      loadError: "Record not found. It may have been removed.",
    });
    expect(wrapper.find(".app-alert[data-tone='err']").exists()).toBe(true);
  });

  it("shows the sync error alert when the record carries an errorMessage", () => {
    const wrapper = mountModal({
      record: makeRecord({ status: "error", errorMessage: "disk full" }),
    });
    expect(wrapper.text()).toContain("disk full");
  });

  it("emits close when the close button is clicked", async () => {
    const wrapper = mountModal();
    await wrapper.find(".app-btn").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits close when the backdrop is clicked", async () => {
    const wrapper = mountModal();
    await wrapper.trigger("mousedown");
    await wrapper.trigger("mouseup");
    await wrapper.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("does not emit close when the card is clicked", async () => {
    const wrapper = mountModal();
    await wrapper.find(".card").trigger("mousedown");
    await wrapper.find(".card").trigger("mouseup");
    await wrapper.find(".card").trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  it("does not emit close when a drag starts in the card and ends on the backdrop", async () => {
    const wrapper = mountModal();
    await wrapper.find(".card").trigger("mousedown");
    await wrapper.trigger("mouseup");
    await wrapper.trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  it("does not emit close when a drag starts on the backdrop and ends in the card", async () => {
    const wrapper = mountModal();
    await wrapper.trigger("mousedown");
    await wrapper.find(".card").trigger("mouseup");
    await wrapper.trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  it("stops listening for Escape and restores focus after unmount", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const wrapper = mount(RecordDetailModal, {
      attachTo: document.body,
      props: { record: makeRecord(), isLoading: false, loadError: null },
      global: { stubs },
    });

    wrapper.unmount();
    expect(document.activeElement).toBe(opener);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toBeFalsy();

    opener.remove();
  });

  it("emits close when Escape is pressed", async () => {
    const wrapper = mountModal();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("ignores non-Escape keys", async () => {
    const wrapper = mountModal();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  it("matches the snapshot for a loaded record", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_NOW));

    try {
      const wrapper = mountModal();
      expect(wrapper.html()).toMatchSnapshot();
    } finally {
      vi.useRealTimers();
    }
  });
});
