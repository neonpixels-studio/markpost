import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FieldMappingModal from "../../app/components/FieldMappingModal.vue";
import AppIcon from "../../app/components/AppIcon.vue";
import AppAlert from "../../app/components/AppAlert.vue";
import AppField from "../../app/components/AppField.vue";
import AppBtn from "../../app/components/AppBtn.vue";
import type { FieldMappingState } from "../../app/types/fieldMapping";

const globalConfig = {
  global: {
    components: { AppIcon, AppAlert, AppField, AppBtn },
  },
};

function stateWithMapping(fieldMapping: unknown): FieldMappingState {
  return {
    source: { uuid: "uuid-1", name: "GitHub", fieldMapping },
  };
}

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper
    .findAll("button")
    .find((button) => button.text().includes(label));
}

function findInputByPlaceholder(
  wrapper: ReturnType<typeof mount>,
  placeholder: string,
) {
  return wrapper
    .findAll("input")
    .find((input) => input.attributes("placeholder") === placeholder);
}

describe("FieldMappingModal", () => {
  it("matches snapshot with no existing mapping", () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: { fieldMappingState: stateWithMapping(null) },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot with an existing mapping", () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: {
        fieldMappingState: stateWithMapping({
          title: "data.subject",
          tags: "data.labels",
        }),
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows the source name in the header", () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: { fieldMappingState: stateWithMapping(null) },
    });
    expect(wrapper.text()).toContain("GitHub");
  });

  it("seeds each field from the existing mapping", () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: {
        fieldMappingState: stateWithMapping({
          title: "data.subject",
          content: "data.body",
        }),
      },
    });
    expect(
      (
        findInputByPlaceholder(wrapper, "e.g. title")
          ?.element as HTMLInputElement
      ).value,
    ).toBe("data.subject");
    expect(
      (
        findInputByPlaceholder(wrapper, "e.g. content")
          ?.element as HTMLInputElement
      ).value,
    ).toBe("data.body");
  });

  it("treats a non-conforming stored mapping as blank rather than erroring", () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: { fieldMappingState: stateWithMapping({ title: 42 }) },
    });
    expect(
      (
        findInputByPlaceholder(wrapper, "e.g. title")
          ?.element as HTMLInputElement
      ).value,
    ).toBe("");
  });

  it("emits save with a built FieldMappingConfig from the edited fields", async () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: { fieldMappingState: stateWithMapping(null) },
    });

    await findInputByPlaceholder(wrapper, "e.g. title")?.setValue(
      "  data.subject  ",
    );
    await findButton(wrapper, "save mapping")?.trigger("click");

    expect(wrapper.emitted("save")?.[0]).toEqual([{ title: "data.subject" }]);
  });

  it("emits save with null when every field is cleared", async () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: {
        fieldMappingState: stateWithMapping({ title: "data.subject" }),
      },
    });

    await findInputByPlaceholder(wrapper, "e.g. title")?.setValue("");
    await findButton(wrapper, "save mapping")?.trigger("click");

    expect(wrapper.emitted("save")?.[0]).toEqual([null]);
  });

  it("emits close when cancel is clicked", async () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: { fieldMappingState: stateWithMapping(null) },
    });
    await findButton(wrapper, "cancel")?.trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("emits close from the backdrop", async () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: { fieldMappingState: stateWithMapping(null) },
    });
    await wrapper.find("div").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("does not emit close from the backdrop while submitting", async () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: { fieldMappingState: stateWithMapping(null), submitting: true },
    });
    await wrapper.find("div").trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("hides the header close button while submitting", () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: { fieldMappingState: stateWithMapping(null), submitting: true },
    });
    expect(wrapper.find(".icon-btn").exists()).toBe(false);
  });

  it("disables save and cancel while submitting, and emits nothing", async () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: { fieldMappingState: stateWithMapping(null), submitting: true },
    });
    const saveButton = findButton(wrapper, "save mapping");
    const cancelButton = findButton(wrapper, "cancel");
    expect(saveButton?.attributes("disabled")).toBeDefined();
    expect(cancelButton?.attributes("disabled")).toBeDefined();

    await saveButton?.trigger("click");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("renders a save error inline", () => {
    const wrapper = mount(FieldMappingModal, {
      ...globalConfig,
      props: {
        fieldMappingState: stateWithMapping(null),
        error: "Failed to save field mapping. Please try again.",
      },
    });
    expect(wrapper.text()).toContain("Failed to save");
    expect(wrapper.text()).toContain("Failed to save field mapping");
  });
});
