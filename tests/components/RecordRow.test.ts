import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import RecordRow from "../../app/components/RecordRow.vue";
import AppIcon from "../../app/components/AppIcon.vue";
import AppBadge from "../../app/components/AppBadge.vue";
import AppBtn from "../../app/components/AppBtn.vue";
import InputCheckbox from "../../app/components/InputCheckbox.vue";
import type { RecordResource } from "../../app/composables/useRecords";

const globalConfig = {
  global: {
    components: { AppIcon, AppBadge, AppBtn, InputCheckbox },
  },
};

function makeRecord(
  overrides: Partial<RecordResource["attributes"]> = {},
): RecordResource {
  return {
    type: "records",
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

describe("RecordRow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches snapshot", () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: { record: makeRecord(), selected: false },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders a badge with the record's status", () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: { record: makeRecord({ status: "error" }), selected: false },
    });
    expect(wrapper.find(".badge").exists()).toBe(true);
    expect(wrapper.text()).toContain("error");
  });

  it("displays an em-dash when the record has no filePath", () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: { record: makeRecord({ filePath: null }), selected: false },
    });
    expect(wrapper.text()).toContain("—");
  });

  it("emits open with the record's uuid when the row is clicked", async () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: { record: makeRecord({ uuid: "row-uuid" }), selected: false },
    });
    await wrapper.trigger("click");
    expect(wrapper.emitted("open")).toEqual([["row-uuid"]]);
  });

  it("emits open when the row receives Enter", async () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: { record: makeRecord({ uuid: "row-uuid" }), selected: false },
    });
    await wrapper.trigger("keydown.enter");
    expect(wrapper.emitted("open")).toEqual([["row-uuid"]]);
  });

  it("emits open when the row receives Space", async () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: { record: makeRecord({ uuid: "row-uuid" }), selected: false },
    });
    await wrapper.trigger("keydown.space");
    expect(wrapper.emitted("open")).toEqual([["row-uuid"]]);
  });

  it("emits toggle-select without opening the record when the checkbox changes", async () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: { record: makeRecord({ uuid: "row-uuid" }), selected: false },
    });
    await wrapper.find("input[type=checkbox]").setValue(true);
    expect(wrapper.emitted("toggle-select")).toEqual([["row-uuid"]]);
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  it("reflects the selected prop on the checkbox", () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: { record: makeRecord(), selected: true },
    });
    const checkbox = wrapper.find("input[type=checkbox]")
      .element as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("emits delete without opening the record when the delete button is clicked", async () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: { record: makeRecord({ uuid: "row-uuid" }), selected: false },
    });
    await wrapper.find(".btn").trigger("click");
    expect(wrapper.emitted("delete")).toEqual([["row-uuid"]]);
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  it("disables the delete button when disabled is true", () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: {
        record: makeRecord(),
        selected: false,
        disabled: true,
      },
    });
    expect(wrapper.find(".btn").attributes("disabled")).toBeDefined();
  });

  it("does not emit delete when clicked while disabled", async () => {
    const wrapper = mount(RecordRow, {
      ...globalConfig,
      props: {
        record: makeRecord({ uuid: "row-uuid" }),
        selected: false,
        disabled: true,
      },
    });
    await wrapper.find(".btn").trigger("click");
    expect(wrapper.emitted("delete")).toBeUndefined();
  });
});
