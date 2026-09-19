import { describe, it, expect } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import RecordBulkActions from "../../app/components/RecordBulkActions.vue";
import AppBtn from "../../app/components/AppBtn.vue";
import { RECORD_STATUS_VALUES } from "../../app/composables/useRecords";

const globalConfig = {
  global: {
    components: { AppBtn },
  },
};

function mountBulkActions(
  props: { selectedCount?: number; disabled?: boolean } = {},
) {
  return mount(RecordBulkActions, {
    ...globalConfig,
    props: { selectedCount: 1, disabled: false, ...props },
  });
}

function findButton(wrapper: VueWrapper, label: string) {
  return wrapper.findAll(".btn").find((button) => button.text() === label);
}

// Every button rendered by the template: one per record status, plus
// "delete selected" and "clear".
const TOTAL_BUTTON_COUNT = RECORD_STATUS_VALUES.length + 2;

describe("RecordBulkActions", () => {
  it("matches snapshot", () => {
    const wrapper = mountBulkActions({ selectedCount: 2 });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows the selected count", () => {
    const wrapper = mountBulkActions({ selectedCount: 3 });
    expect(wrapper.text()).toContain("3 selected");
  });

  it("renders a 'mark <status>' button for every record status", () => {
    const wrapper = mountBulkActions();
    const labels = wrapper.findAll(".btn").map((button) => button.text());
    for (const status of RECORD_STATUS_VALUES) {
      expect(labels).toContain(`mark ${status}`);
    }
  });

  it("emits mark-status with the clicked status", async () => {
    const wrapper = mountBulkActions();
    await findButton(wrapper, "mark pending")?.trigger("click");
    expect(wrapper.emitted("mark-status")).toEqual([["pending"]]);
  });

  it("emits delete-selected when 'delete selected' is clicked", async () => {
    const wrapper = mountBulkActions();
    await findButton(wrapper, "delete selected")?.trigger("click");
    expect(wrapper.emitted("delete-selected")).toEqual([[]]);
  });

  it("emits clear when 'clear' is clicked", async () => {
    const wrapper = mountBulkActions();
    await findButton(wrapper, "clear")?.trigger("click");
    expect(wrapper.emitted("clear")).toEqual([[]]);
  });

  it("disables every bulk-action button, including clear, while disabled", () => {
    const wrapper = mountBulkActions({ disabled: true });
    const buttons = wrapper.findAll(".btn");

    expect(buttons).toHaveLength(TOTAL_BUTTON_COUNT);
    for (const button of buttons) {
      expect(button.attributes("disabled")).toBeDefined();
    }
  });

  it("leaves every bulk-action button, including clear, enabled when not disabled", () => {
    const wrapper = mountBulkActions({ disabled: false });
    const buttons = wrapper.findAll(".btn");

    expect(buttons).toHaveLength(TOTAL_BUTTON_COUNT);
    for (const button of buttons) {
      expect(button.attributes("disabled")).toBeUndefined();
    }
  });
});
