import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import InputCheckbox from "../../app/components/InputCheckbox.vue";
import AppIcon from "../../app/components/AppIcon.vue";

const globalConfig = {
  global: {
    components: { AppIcon },
  },
};

describe("InputCheckbox", () => {
  it("matches snapshot", () => {
    const wrapper = mount(InputCheckbox, {
      ...globalConfig,
      props: { modelValue: false, label: "Accept terms" },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders label text", () => {
    const wrapper = mount(InputCheckbox, {
      ...globalConfig,
      props: { modelValue: false, label: "Accept terms" },
    });
    expect(wrapper.text()).toContain("Accept terms");
  });

  it("shows check icon when checked", () => {
    const wrapper = mount(InputCheckbox, {
      ...globalConfig,
      props: { modelValue: true, label: "Checked" },
    });
    expect(wrapper.findComponent(AppIcon).exists()).toBe(true);
  });

  it("hides check icon when unchecked", () => {
    const wrapper = mount(InputCheckbox, {
      ...globalConfig,
      props: { modelValue: false, label: "Unchecked" },
    });
    expect(wrapper.findComponent(AppIcon).exists()).toBe(false);
  });

  it("emits update:modelValue true when clicked while unchecked", async () => {
    const wrapper = mount(InputCheckbox, {
      ...globalConfig,
      props: { modelValue: false, label: "Click me" },
    });
    await wrapper.find("input").setValue(true);
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([true]);
  });

  it("emits update:modelValue false when clicked while checked", async () => {
    const wrapper = mount(InputCheckbox, {
      ...globalConfig,
      props: { modelValue: true, label: "Click me" },
    });
    await wrapper.find("input").setValue(false);
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("forwards a non-presentational attr like aria-label onto the real input", () => {
    const wrapper = mount(InputCheckbox, {
      ...globalConfig,
      props: { modelValue: false },
      attrs: { "aria-label": "Select all" },
    });
    expect(wrapper.find("input").attributes("aria-label")).toBe("Select all");
    expect(wrapper.find("label").attributes("aria-label")).toBeUndefined();
  });

  it("keeps a caller's class and style on the visible label, not the hidden input", () => {
    const wrapper = mount(InputCheckbox, {
      ...globalConfig,
      props: { modelValue: false },
      attrs: { class: "extra-class", style: "margin-left: 8px" },
    });
    const label = wrapper.find("label");
    expect(label.classes()).toContain("extra-class");
    expect(label.attributes("style")).toContain("margin-left: 8px");
    expect(wrapper.find("input").attributes("style")).not.toContain(
      "margin-left",
    );
  });

  it("also accepts an object-form style binding, not just a string", () => {
    const wrapper = mount(InputCheckbox, {
      ...globalConfig,
      props: { modelValue: false },
      attrs: { style: { marginLeft: "8px" } },
    });
    expect(wrapper.find("label").attributes("style")).toContain(
      "margin-left: 8px",
    );
  });

  it("keeps a caller's title and click listener on the visible label, not the hidden input", async () => {
    const onClick = vi.fn();
    const wrapper = mount(InputCheckbox, {
      ...globalConfig,
      props: { modelValue: false },
      attrs: { title: "Toggle", onClick },
    });
    const label = wrapper.find("label");
    expect(label.attributes("title")).toBe("Toggle");
    expect(wrapper.find("input").attributes("title")).toBeUndefined();

    await label.trigger("click");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
