import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

import RecordTitleField from "../../app/components/RecordTitleField.vue";

const stubs = {
  AppBtn: {
    template:
      '<button class="app-btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    props: ["variant", "size", "icon", "disabled"],
    emits: ["click"],
  },
};

function mountField(props: Record<string, unknown> = {}) {
  return mount(RecordTitleField, {
    props: {
      title: "Test Record",
      modelValue: "",
      isEditing: false,
      disabled: false,
      ...props,
    },
    global: { stubs },
  });
}

describe("RecordTitleField", () => {
  it("shows the title and an edit button when not editing", () => {
    const wrapper = mountField();
    expect(wrapper.text()).toContain("Test Record");
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find(".app-btn").text()).toBe("edit");
  });

  it("emits edit when the edit button is clicked", async () => {
    const wrapper = mountField();
    await wrapper.find(".app-btn").trigger("click");
    expect(wrapper.emitted("edit")).toBeTruthy();
  });

  it("shows an editable input seeded with modelValue when editing", () => {
    const wrapper = mountField({ isEditing: true, modelValue: "Draft title" });
    const input = wrapper.find<HTMLInputElement>("input");
    expect(input.element.value).toBe("Draft title");
    expect(wrapper.find(".app-btn").exists()).toBe(false);
  });

  it("emits update:modelValue as the input changes", async () => {
    const wrapper = mountField({ isEditing: true });
    await wrapper.find("input").setValue("Changed");
    expect(wrapper.emitted("update:modelValue")).toEqual([["Changed"]]);
  });

  it("disables the input while saving", () => {
    const wrapper = mountField({ isEditing: true, disabled: true });
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
  });

  it("shows the title validation error next to the input and wires aria-describedby", () => {
    const wrapper = mountField({
      isEditing: true,
      titleError: "Title can't be empty.",
    });

    expect(wrapper.text()).toContain("Title can't be empty.");
    const input = wrapper.find("input");
    expect(input.attributes("aria-invalid")).toBe("true");
    // useId() generates the id at runtime (never a hardcoded literal, so two
    // instances on the page can't collide) — assert the relationship rather
    // than a fixed string.
    const describedById = input.attributes("aria-describedby");
    expect(describedById).toBeTruthy();
    expect(wrapper.find(`#${describedById}`).text()).toBe(
      "Title can't be empty.",
    );
  });

  it("shows no validation error and no aria-invalid when titleError is null", () => {
    const wrapper = mountField({ isEditing: true });

    const input = wrapper.find("input");
    expect(input.attributes("aria-invalid")).toBe("false");
    expect(input.attributes("aria-describedby")).toBeUndefined();
  });

  it("moves focus into the input when isEditing flips true (the edit button that had it just unmounted)", async () => {
    const wrapper = mount(RecordTitleField, {
      attachTo: document.body,
      props: {
        title: "Test Record",
        modelValue: "",
        isEditing: false,
        disabled: false,
      },
      global: { stubs },
    });

    try {
      const editButton = wrapper.find(".app-btn");
      await editButton.element.focus();
      expect(document.activeElement).toBe(editButton.element);

      await wrapper.setProps({ isEditing: true });
      // The watcher's own callback is async (it awaits nextTick() before
      // focusing, so the v-if has swapped the input in first) — setProps
      // only awaits Vue's render tick, not that extra microtask.
      await flushPromises();

      expect(document.activeElement).toBe(wrapper.find("input").element);
    } finally {
      wrapper.unmount();
    }
  });
});
