import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import RecordContentField from "../../app/components/RecordContentField.vue";

const stubs = {
  AppBtn: {
    template:
      '<button class="app-btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    props: ["variant", "size", "icon", "disabled"],
    emits: ["click"],
  },
  AppAlert: {
    template: '<div class="app-alert" :data-tone="tone"><slot /></div>',
    props: ["tone", "title", "closeable"],
  },
  AppCodeBlock: {
    template: '<div class="app-code-block"><slot /></div>',
    props: ["lang", "copy"],
  },
};

function findButtonByText(
  wrapper: ReturnType<typeof mountField>,
  label: string,
) {
  return wrapper.findAll(".app-btn").find((button) => button.text() === label);
}

function mountField(props: Record<string, unknown> = {}) {
  return mount(RecordContentField, {
    props: {
      content: "Some content",
      modelValue: "",
      isEditing: false,
      isSaving: false,
      canSave: true,
      saveError: null,
      ...props,
    },
    global: { stubs },
  });
}

describe("RecordContentField", () => {
  it("shows the content read-only and no editing controls when not editing", () => {
    const wrapper = mountField();
    expect(wrapper.find(".app-code-block").text()).toContain("Some content");
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(findButtonByText(wrapper, "save")).toBeUndefined();
    expect(findButtonByText(wrapper, "cancel")).toBeUndefined();
  });

  it("shows an editable textarea seeded with modelValue when editing", () => {
    const wrapper = mountField({ isEditing: true, modelValue: "Draft body" });
    expect(wrapper.find<HTMLTextAreaElement>("textarea").element.value).toBe(
      "Draft body",
    );
  });

  it("emits update:modelValue as the textarea changes", async () => {
    const wrapper = mountField({ isEditing: true });
    await wrapper.find("textarea").setValue("Changed body");
    expect(wrapper.emitted("update:modelValue")).toEqual([["Changed body"]]);
  });

  it("emits save and cancel when their buttons are clicked", async () => {
    const wrapper = mountField({ isEditing: true });

    await findButtonByText(wrapper, "save")?.trigger("click");
    await findButtonByText(wrapper, "cancel")?.trigger("click");

    expect(wrapper.emitted("save")).toBeTruthy();
    expect(wrapper.emitted("cancel")).toBeTruthy();
  });

  it("disables save while saving or when canSave is false", () => {
    const savingWrapper = mountField({ isEditing: true, isSaving: true });
    expect(
      findButtonByText(savingWrapper, "saving…")?.attributes("disabled"),
    ).toBeDefined();

    const invalidWrapper = mountField({ isEditing: true, canSave: false });
    expect(
      findButtonByText(invalidWrapper, "save")?.attributes("disabled"),
    ).toBeDefined();
  });

  it("shows the save error alert", () => {
    const wrapper = mountField({
      isEditing: true,
      saveError: "Failed to save changes. Please try again.",
    });

    expect(wrapper.text()).toContain(
      "Failed to save changes. Please try again.",
    );
  });

  it("shows no error alert when saveError is null", () => {
    const wrapper = mountField({ isEditing: true });
    expect(wrapper.find(".app-alert").exists()).toBe(false);
  });
});
