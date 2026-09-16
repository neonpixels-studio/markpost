import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";

const mockUpdateRecordContent = vi.fn();
vi.mock("~/composables/useRecordEdit", () => ({
  updateRecordContent: (...args: unknown[]) => mockUpdateRecordContent(...args),
}));

import RecordDetailModal from "../../app/components/RecordDetailModal.vue";
import RealRecordTitleField from "../../app/components/RecordTitleField.vue";
import RealRecordContentField from "../../app/components/RecordContentField.vue";

function findButtonByText(wrapper: VueWrapper, label: string) {
  return wrapper.findAll(".app-btn").find((button) => button.text() === label);
}

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

function makeErrorRecord(overrides: Record<string, unknown> = {}) {
  return makeRecord({
    status: "error",
    errorMessage: "disk full",
    ...overrides,
  });
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
  // Stubbed here the same way sources.test.ts stubs FieldMappingModal —
  // RecordTitleField/RecordContentField are feature-specific children with
  // their own dedicated test files (RecordTitleField.test.ts,
  // RecordContentField.test.ts); this stub only needs to stay wired closely
  // enough (same aria-labels, .app-btn class, button text) that this file's
  // edit-flow tests can drive it exactly like the real component.
  RecordTitleField: {
    template: `
      <div>
        <input
          v-if="isEditing"
          aria-label="Record title"
          :value="modelValue"
          @input="$emit('update:modelValue', $event.target.value)"
        />
        <div v-if="titleError">{{ titleError }}</div>
        <h3 v-else>{{ title }}</h3>
        <button v-if="!isEditing" class="app-btn" @click="$emit('edit')">
          edit
        </button>
      </div>
    `,
    props: ["title", "modelValue", "isEditing", "disabled", "titleError"],
    emits: ["update:modelValue", "edit"],
  },
  RecordContentField: {
    template: `
      <div>
        <textarea
          v-if="isEditing"
          aria-label="Record content"
          :value="modelValue"
          @input="$emit('update:modelValue', $event.target.value)"
        />
        <div v-else class="app-code-block">{{ content }}</div>
        <div v-if="saveError">{{ saveError }}</div>
        <template v-if="isEditing">
          <button class="app-btn" @click="$emit('cancel')">cancel</button>
          <button
            class="app-btn"
            :disabled="isSaving || !canSave"
            @click="$emit('save')"
          >
            {{ isSaving ? "saving…" : "save" }}
          </button>
        </template>
      </div>
    `,
    props: [
      "content",
      "modelValue",
      "isEditing",
      "isSaving",
      "canSave",
      "saveError",
    ],
    emits: ["update:modelValue", "save", "cancel"],
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
    mockUpdateRecordContent.mockReset();
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
      record: makeErrorRecord(),
    });
    expect(wrapper.text()).toContain("disk full");
  });

  it("shows a fallback message when an error record has no errorMessage", () => {
    const wrapper = mountModal({
      record: makeRecord({ status: "error", errorMessage: null }),
    });
    expect(wrapper.text()).toContain("No error details available.");
  });

  it("shows the fallback message when errorMessage is an empty string", () => {
    const wrapper = mountModal({
      record: makeRecord({ status: "error", errorMessage: "" }),
    });
    expect(wrapper.text()).toContain("No error details available.");
  });

  it("does not show the sync error alert or retry button for a non-error record", () => {
    const wrapper = mountModal({
      record: makeRecord({ status: "synced", errorMessage: null }),
    });
    expect(wrapper.find(".app-alert[data-tone='err']").exists()).toBe(false);
    expect(findButtonByText(wrapper, "retry sync")).toBeUndefined();
  });

  it("emits retry with the record's uuid when the retry button is clicked", async () => {
    const wrapper = mountModal({
      record: makeErrorRecord({ uuid: "error-uuid" }),
    });

    const retryButton = findButtonByText(wrapper, "retry sync");
    expect(retryButton).toBeDefined();
    await retryButton?.trigger("click");

    expect(wrapper.emitted("retry")).toEqual([["error-uuid"]]);
  });

  it("disables the retry button and shows a retrying label while isRetrying is true", () => {
    const wrapper = mountModal({
      record: makeErrorRecord(),
      isRetrying: true,
    });

    const retryButton = findButtonByText(wrapper, "retrying…");
    expect(retryButton).toBeDefined();
    expect(retryButton?.attributes("disabled")).toBeDefined();
  });

  it("disables the retry button without relabeling it when isRetryDisabled is true", () => {
    const wrapper = mountModal({
      record: makeErrorRecord(),
      isRetryDisabled: true,
    });

    const retryButton = findButtonByText(wrapper, "retry sync");
    expect(retryButton).toBeDefined();
    expect(retryButton?.attributes("disabled")).toBeDefined();
  });

  it("shows the retryError message inline when a previous retry attempt failed", () => {
    const wrapper = mountModal({
      record: makeErrorRecord(),
      retryError: "Failed to update records. Please try again.",
    });

    expect(wrapper.find("[data-testid='retry-error']").text()).toBe(
      "Failed to update records. Please try again.",
    );
  });

  it("shows no retryError element when the record has never failed a retry", () => {
    const wrapper = mountModal({
      record: makeErrorRecord(),
    });

    expect(wrapper.find("[data-testid='retry-error']").exists()).toBe(false);
  });

  it("returns focus to the card when a retry moves the record out of error status", async () => {
    const wrapper = mount(RecordDetailModal, {
      attachTo: document.body,
      props: {
        record: makeErrorRecord(),
        isLoading: false,
        loadError: null,
      },
      global: { stubs },
    });

    try {
      const retryButton = findButtonByText(wrapper, "retry sync");
      await retryButton?.element.focus();
      expect(document.activeElement).toBe(retryButton?.element);

      await wrapper.setProps({
        record: makeRecord({ status: "pending", errorMessage: null }),
      });

      expect(document.activeElement).toBe(wrapper.find(".card").element);
    } finally {
      wrapper.unmount();
    }
  });

  it("returns focus to the card when a retry fails and the button re-enables without ever refocusing", async () => {
    const wrapper = mount(RecordDetailModal, {
      attachTo: document.body,
      props: {
        record: makeErrorRecord(),
        isLoading: false,
        loadError: null,
        isRetrying: true,
      },
      global: { stubs },
    });

    try {
      // A disabled element can't hold focus, so simulate the browser's own
      // focus-fixup (Chrome/Firefox move focus to <body> when a focused
      // control is disabled) — jsdom doesn't do this automatically.
      (document.activeElement as HTMLElement | null)?.blur();

      await wrapper.setProps({ isRetrying: false });

      expect(document.activeElement).toBe(wrapper.find(".card").element);
    } finally {
      wrapper.unmount();
    }
  });

  it("does not steal focus the user has already moved elsewhere", async () => {
    const wrapper = mount(RecordDetailModal, {
      attachTo: document.body,
      props: {
        record: makeErrorRecord(),
        isLoading: false,
        loadError: null,
      },
      global: { stubs },
    });

    try {
      const closeButton = findButtonByText(wrapper, "close");
      await closeButton?.element.focus();
      expect(document.activeElement).toBe(closeButton?.element);

      await wrapper.setProps({
        record: makeRecord({ status: "pending", errorMessage: null }),
      });

      expect(document.activeElement).toBe(closeButton?.element);
    } finally {
      wrapper.unmount();
    }
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

  describe("closing while editing", () => {
    it("cancels the edit instead of closing when Escape is pressed", async () => {
      const wrapper = mountModal();
      await findButtonByText(wrapper, "edit")?.trigger("click");

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeFalsy();
      expect(wrapper.find("input[aria-label='Record title']").exists()).toBe(
        false,
      );
    });

    it("does not close on a backdrop click while editing", async () => {
      const wrapper = mountModal();
      await findButtonByText(wrapper, "edit")?.trigger("click");

      await wrapper.trigger("mousedown");
      await wrapper.trigger("mouseup");
      await wrapper.trigger("click");

      expect(wrapper.emitted("close")).toBeFalsy();
      expect(wrapper.find("input[aria-label='Record title']").exists()).toBe(
        true,
      );
    });

    it("does not close on the header close button while editing", async () => {
      const wrapper = mountModal();
      await findButtonByText(wrapper, "edit")?.trigger("click");

      await findButtonByText(wrapper, "close")?.trigger("click");

      expect(wrapper.emitted("close")).toBeFalsy();
      expect(wrapper.find("input[aria-label='Record title']").exists()).toBe(
        true,
      );
    });

    it("returns focus to the card when canceling drops focus to <body>", async () => {
      const wrapper = mount(RecordDetailModal, {
        attachTo: document.body,
        props: { record: makeRecord(), isLoading: false, loadError: null },
        global: { stubs },
      });

      try {
        await findButtonByText(wrapper, "edit")?.trigger("click");
        const cancelButton = findButtonByText(wrapper, "cancel");
        await cancelButton?.element.focus();
        expect(document.activeElement).toBe(cancelButton?.element);

        // jsdom/happy-dom don't replicate the browser's own focus-fixup when
        // a focused element unmounts (see the retry-button tests above for
        // the same simulation), so drop focus to <body> by hand — that's
        // the state the real browser would leave it in once the Cancel
        // button (still focused) is removed by isEditing flipping false.
        (document.activeElement as HTMLElement | null)?.blur();

        await cancelButton?.trigger("click");

        expect(document.activeElement).toBe(wrapper.find(".card").element);
      } finally {
        wrapper.unmount();
      }
    });
  });

  describe("editing title and content", () => {
    it("shows the edit button and no edit fields by default", () => {
      const wrapper = mountModal();
      expect(findButtonByText(wrapper, "edit")).toBeDefined();
      expect(wrapper.find("input[aria-label='Record title']").exists()).toBe(
        false,
      );
    });

    it("enters edit mode seeded with the current title and content", async () => {
      const wrapper = mountModal();

      await findButtonByText(wrapper, "edit")?.trigger("click");

      const titleInput = wrapper.find<HTMLInputElement>(
        "input[aria-label='Record title']",
      );
      const contentTextarea = wrapper.find<HTMLTextAreaElement>(
        "textarea[aria-label='Record content']",
      );
      expect(titleInput.element.value).toBe("Test Record");
      expect(contentTextarea.element.value).toBe("# Heading\n\nBody");
    });

    it("cancels edit mode without saving", async () => {
      const wrapper = mountModal();

      await findButtonByText(wrapper, "edit")?.trigger("click");
      await wrapper
        .find("input[aria-label='Record title']")
        .setValue("Changed title");
      await findButtonByText(wrapper, "cancel")?.trigger("click");

      expect(wrapper.find("input[aria-label='Record title']").exists()).toBe(
        false,
      );
      expect(wrapper.text()).toContain("Test Record");
      expect(mockUpdateRecordContent).not.toHaveBeenCalled();
    });

    it("disables save and shows a validation message when the title is blank", async () => {
      const wrapper = mountModal();

      await findButtonByText(wrapper, "edit")?.trigger("click");
      await wrapper.find("input[aria-label='Record title']").setValue("   ");

      expect(wrapper.text()).toContain("Title can't be empty.");
      expect(findButtonByText(wrapper, "save")?.attributes("disabled")).toBe(
        "",
      );
      expect(mockUpdateRecordContent).not.toHaveBeenCalled();
    });

    it("saves the edit, exits edit mode, and emits updated with the server response", async () => {
      const updatedRecord = makeRecord({
        title: "Fixed title",
        content: "Fixed content",
      });
      mockUpdateRecordContent.mockResolvedValue(updatedRecord);
      const wrapper = mountModal();

      await findButtonByText(wrapper, "edit")?.trigger("click");
      await wrapper
        .find("input[aria-label='Record title']")
        .setValue("Fixed title");
      await wrapper
        .find("textarea[aria-label='Record content']")
        .setValue("Fixed content");
      await findButtonByText(wrapper, "save")?.trigger("click");
      // Waits on the resolved effect (the input disappearing once isEditing
      // flips false), not just on the request having been made — the
      // request itself fires synchronously inside the click handler, so
      // asserting only that it was "called" would pass before the
      // response's continuation ever runs.
      await vi.waitFor(() => {
        expect(wrapper.find("input[aria-label='Record title']").exists()).toBe(
          false,
        );
      });

      expect(mockUpdateRecordContent).toHaveBeenCalledWith("uuid-1", {
        title: "Fixed title",
        content: "Fixed content",
      });
      expect(wrapper.text()).toContain("Fixed title");
      expect(wrapper.emitted("updated")).toEqual([[updatedRecord]]);
    });

    it("trims the title before sending it to the server", async () => {
      mockUpdateRecordContent.mockResolvedValue(makeRecord());
      const wrapper = mountModal();

      await findButtonByText(wrapper, "edit")?.trigger("click");
      await wrapper
        .find("input[aria-label='Record title']")
        .setValue("  Padded  ");
      await findButtonByText(wrapper, "save")?.trigger("click");
      await vi.waitFor(() => {
        expect(wrapper.find("input[aria-label='Record title']").exists()).toBe(
          false,
        );
      });

      expect(mockUpdateRecordContent).toHaveBeenCalledWith(
        "uuid-1",
        expect.objectContaining({ title: "Padded" }),
      );
    });

    it("shows an error and stays in edit mode when the save fails", async () => {
      mockUpdateRecordContent.mockRejectedValue({
        data: { errors: [{ detail: "Title must be a non-empty string" }] },
      });
      const wrapper = mountModal();

      await findButtonByText(wrapper, "edit")?.trigger("click");
      await findButtonByText(wrapper, "save")?.trigger("click");
      await vi.waitFor(() => {
        expect(wrapper.text()).toContain("Title must be a non-empty string");
      });

      expect(wrapper.find("input[aria-label='Record title']").exists()).toBe(
        true,
      );
      expect(wrapper.emitted("updated")).toBeFalsy();
    });

    it("resets edit state when the parent starts loading a different record", async () => {
      const wrapper = mountModal();

      await findButtonByText(wrapper, "edit")?.trigger("click");
      expect(wrapper.find("input[aria-label='Record title']").exists()).toBe(
        true,
      );

      await wrapper.setProps({ record: null, isLoading: true });

      await wrapper.setProps({
        record: makeRecord({ uuid: "uuid-2", title: "Other Record" }),
        isLoading: false,
      });

      expect(wrapper.find("input[aria-label='Record title']").exists()).toBe(
        false,
      );
      expect(wrapper.text()).toContain("Other Record");
    });

    it("ignores a save response that resolves after the parent has switched to a different record", async () => {
      let resolveSave!: (record: ReturnType<typeof makeRecord>) => void;
      mockUpdateRecordContent.mockReturnValue(
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
      );
      const wrapper = mountModal();

      await findButtonByText(wrapper, "edit")?.trigger("click");
      await findButtonByText(wrapper, "save")?.trigger("click");

      // The parent moves on to a different record while the save is still
      // in flight (isLoading toggles true, then a different record arrives).
      await wrapper.setProps({ record: null, isLoading: true });
      await wrapper.setProps({
        record: makeRecord({ uuid: "uuid-2", title: "Other Record" }),
        isLoading: false,
      });

      // mockUpdateRecordContent was already called synchronously by the
      // earlier click (before the props even changed) — waiting on that
      // call happening would prove nothing about whether resolveSave's
      // continuation ran. flushPromises actually drains it, so the
      // assertions below cover the resolved response, not just the request.
      resolveSave(makeRecord({ title: "Stale save response" }));
      await flushPromises();

      expect(wrapper.text()).toContain("Other Record");
      expect(wrapper.text()).not.toContain("Stale save response");
      expect(wrapper.emitted("updated")).toBeFalsy();
    });

    it("clears a saved override once the parent pushes a fresher copy of the same record", async () => {
      const updatedRecord = makeRecord({ title: "Fixed title" });
      mockUpdateRecordContent.mockResolvedValue(updatedRecord);
      const wrapper = mountModal();

      await findButtonByText(wrapper, "edit")?.trigger("click");
      await findButtonByText(wrapper, "save")?.trigger("click");
      await vi.waitFor(() => {
        expect(wrapper.text()).toContain("Fixed title");
      });

      // A same-record update from elsewhere (e.g. retryRecord's
      // applyDetailUpdate) is authoritative — it was read from the database
      // after this save already landed there — so it replaces the local
      // override rather than being shadowed by it forever.
      await wrapper.setProps({
        record: makeRecord({ title: "Fixed title", status: "pending" }),
      });

      expect(wrapper.text()).toContain("pending");
      expect(wrapper.text()).toContain("Fixed title");
    });

    // RecordTitleField/RecordContentField are stubbed everywhere else in
    // this file (see the comment above the stubs above), so a renamed prop
    // (e.g. `canSave` -> `canSubmit`) would pass every other test here
    // silently. This one mounts the real children — only their own leaf UI
    // primitives (AppBtn, AppAlert, AppCodeBlock) stay stubbed — so a drift
    // between what RecordDetailModal passes and what the child declares
    // shows up as a real, unstubbed rendering difference.
    it("wires isTitleValid/saveError through to the real title and content fields", async () => {
      const { RecordTitleField, RecordContentField, ...leafStubs } = stubs;
      const wrapper = mount(RecordDetailModal, {
        props: { record: makeRecord(), isLoading: false, loadError: null },
        global: {
          stubs: leafStubs,
          components: {
            RecordTitleField: RealRecordTitleField,
            RecordContentField: RealRecordContentField,
          },
        },
      });

      await findButtonByText(wrapper, "edit")?.trigger("click");
      await wrapper.find("input[aria-label='Record title']").setValue("   ");

      const titleInput = wrapper.find("input[aria-label='Record title']");
      expect(titleInput.attributes("aria-invalid")).toBe("true");
      expect(wrapper.text()).toContain("Title can't be empty.");
      expect(findButtonByText(wrapper, "save")?.attributes("disabled")).toBe(
        "",
      );
    });
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

  it("matches the snapshot for a record in error status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_NOW));

    try {
      const wrapper = mountModal({
        record: makeErrorRecord(),
      });
      expect(wrapper.html()).toMatchSnapshot();
    } finally {
      vi.useRealTimers();
    }
  });
});
