import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RecordBulkActions from "../../app/components/RecordBulkActions.vue";
import AppBtn from "../../app/components/AppBtn.vue";
import { RECORD_STATUS_VALUES } from "../../app/composables/useRecords";

const globalConfig = {
  global: {
    components: { AppBtn },
  },
};

describe("RecordBulkActions", () => {
  it("matches snapshot", () => {
    const wrapper = mount(RecordBulkActions, {
      ...globalConfig,
      props: { selectedCount: 2, disabled: false },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows the selected count", () => {
    const wrapper = mount(RecordBulkActions, {
      ...globalConfig,
      props: { selectedCount: 3, disabled: false },
    });
    expect(wrapper.text()).toContain("3 selected");
  });

  it("renders a 'mark <status>' button for every record status", () => {
    const wrapper = mount(RecordBulkActions, {
      ...globalConfig,
      props: { selectedCount: 1, disabled: false },
    });
    const labels = wrapper.findAll(".btn").map((button) => button.text());
    for (const status of RECORD_STATUS_VALUES) {
      expect(labels).toContain(`mark ${status}`);
    }
  });

  it("emits mark-status with the clicked status", async () => {
    const wrapper = mount(RecordBulkActions, {
      ...globalConfig,
      props: { selectedCount: 1, disabled: false },
    });
    const markPendingButton = wrapper
      .findAll(".btn")
      .find((button) => button.text() === "mark pending");
    await markPendingButton?.trigger("click");
    expect(wrapper.emitted("mark-status")).toEqual([["pending"]]);
  });

  it("emits delete-selected when 'delete selected' is clicked", async () => {
    const wrapper = mount(RecordBulkActions, {
      ...globalConfig,
      props: { selectedCount: 1, disabled: false },
    });
    const deleteButton = wrapper
      .findAll(".btn")
      .find((button) => button.text() === "delete selected");
    await deleteButton?.trigger("click");
    expect(wrapper.emitted("delete-selected")).toEqual([[]]);
  });

  it("emits clear when 'clear' is clicked", async () => {
    const wrapper = mount(RecordBulkActions, {
      ...globalConfig,
      props: { selectedCount: 1, disabled: false },
    });
    const clearButton = wrapper
      .findAll(".btn")
      .find((button) => button.text() === "clear");
    await clearButton?.trigger("click");
    expect(wrapper.emitted("clear")).toEqual([[]]);
  });

  it("disables the mark-status and delete-selected buttons while disabled, but not clear", () => {
    const wrapper = mount(RecordBulkActions, {
      ...globalConfig,
      props: { selectedCount: 1, disabled: true },
    });
    const buttons = wrapper.findAll(".btn");
    const clearButton = buttons.find((button) => button.text() === "clear");
    const otherButtons = buttons.filter((button) => button.text() !== "clear");

    expect(clearButton?.attributes("disabled")).toBeUndefined();
    for (const button of otherButtons) {
      expect(button.attributes("disabled")).toBeDefined();
    }
  });
});
