import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import InputSelect from "../../app/components/InputSelect.vue";

describe("InputSelect", () => {
  it("matches snapshot", () => {
    const wrapper = mount(InputSelect, {
      props: {
        modelValue: "a",
        options: ["a", "b", "c"],
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders string options as <option> elements", () => {
    const wrapper = mount(InputSelect, {
      props: {
        modelValue: "a",
        options: ["a", "b", "c"],
      },
    });
    const options = wrapper.findAll("option");
    expect(options).toHaveLength(3);
    expect(options[0].text()).toBe("a");
    expect(options[1].text()).toBe("b");
  });

  it("normalizes object options", () => {
    const wrapper = mount(InputSelect, {
      props: {
        modelValue: "monthly",
        options: [
          { value: "monthly", label: "Monthly" },
          { value: "yearly", label: "Yearly" },
        ],
      },
    });
    const options = wrapper.findAll("option");
    expect(options[0].text()).toBe("Monthly");
    expect(options[1].text()).toBe("Yearly");
  });

  it("reflects modelValue as the selected option", () => {
    const wrapper = mount(InputSelect, {
      props: {
        modelValue: "b",
        options: ["a", "b", "c"],
      },
    });
    expect(wrapper.find("select").element.value).toBe("b");
  });

  it("emits update:modelValue with the selected value on change", async () => {
    const wrapper = mount(InputSelect, {
      props: {
        modelValue: "a",
        options: ["a", "b", "c"],
      },
    });
    await wrapper.find("select").setValue("c");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["c"]);
  });

  it("disables the select when disabled is true", () => {
    const wrapper = mount(InputSelect, {
      props: {
        modelValue: "a",
        options: ["a", "b", "c"],
        disabled: true,
      },
    });
    expect(wrapper.find("select").attributes("disabled")).toBeDefined();
  });
});
