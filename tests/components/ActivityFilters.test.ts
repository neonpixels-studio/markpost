import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ActivityFilters from "../../app/components/ActivityFilters.vue";
import InputSegmented from "../../app/components/InputSegmented.vue";
import InputSelect from "../../app/components/InputSelect.vue";

const globalConfig = {
  global: {
    components: { InputSegmented, InputSelect },
  },
};

function makeSource(uuid: string, name: string) {
  return { attributes: { uuid, name } };
}

describe("ActivityFilters", () => {
  it("matches snapshot with no sources", () => {
    const wrapper = mount(ActivityFilters, {
      ...globalConfig,
      props: { kindFilter: "all", sourceFilter: "all", sources: [] },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot with sources loaded", () => {
    const wrapper = mount(ActivityFilters, {
      ...globalConfig,
      props: {
        kindFilter: "all",
        sourceFilter: "all",
        sources: [makeSource("source-1", "Prod deploys")],
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders every event kind plus 'all' as segmented options", () => {
    const wrapper = mount(ActivityFilters, {
      ...globalConfig,
      props: { kindFilter: "all", sourceFilter: "all", sources: [] },
    });
    const labels = wrapper.findAll("button").map((button) => button.text());
    expect(labels).toEqual(["all", "ok", "dim", "warn", "err"]);
  });

  it("does not render the source select when there are no sources", () => {
    const wrapper = mount(ActivityFilters, {
      ...globalConfig,
      props: { kindFilter: "all", sourceFilter: "all", sources: [] },
    });
    expect(wrapper.find("select").exists()).toBe(false);
  });

  it("renders 'all sources' plus one option per source", () => {
    const wrapper = mount(ActivityFilters, {
      ...globalConfig,
      props: {
        kindFilter: "all",
        sourceFilter: "all",
        sources: [
          makeSource("source-1", "Prod deploys"),
          makeSource("source-2", "Staging deploys"),
        ],
      },
    });
    const labels = wrapper.findAll("option").map((option) => option.text());
    expect(labels).toEqual(["all sources", "Prod deploys", "Staging deploys"]);
  });

  it("emits update:kindFilter when a kind option is clicked", async () => {
    const wrapper = mount(ActivityFilters, {
      ...globalConfig,
      props: { kindFilter: "all", sourceFilter: "all", sources: [] },
    });
    const errButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "err");
    await errButton?.trigger("click");
    expect(wrapper.emitted("update:kindFilter")?.[0]).toEqual(["err"]);
  });

  it("emits update:sourceFilter when a source option is selected", async () => {
    const wrapper = mount(ActivityFilters, {
      ...globalConfig,
      props: {
        kindFilter: "all",
        sourceFilter: "all",
        sources: [makeSource("source-1", "Prod deploys")],
      },
    });
    await wrapper.find("select").setValue("source-1");
    expect(wrapper.emitted("update:sourceFilter")?.[0]).toEqual(["source-1"]);
  });

  it("disables both controls when disabled is true", () => {
    const wrapper = mount(ActivityFilters, {
      ...globalConfig,
      props: {
        kindFilter: "all",
        sourceFilter: "all",
        sources: [makeSource("source-1", "Prod deploys")],
        disabled: true,
      },
    });
    expect(wrapper.find("button").attributes("disabled")).toBeDefined();
    expect(wrapper.find("select").attributes("disabled")).toBeDefined();
  });
});
