import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppLoadMore from "../../app/components/AppLoadMore.vue";
import AppBtn from "../../app/components/AppBtn.vue";
import AppIcon from "../../app/components/AppIcon.vue";

const globalConfig = {
  global: {
    components: { AppBtn, AppIcon },
  },
};

describe("AppLoadMore", () => {
  it("matches snapshot in the idle state", () => {
    const wrapper = mount(AppLoadMore, globalConfig);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot in the loading state", () => {
    const wrapper = mount(AppLoadMore, {
      ...globalConfig,
      props: { isLoading: true },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows the load-more label when idle", () => {
    const wrapper = mount(AppLoadMore, globalConfig);
    expect(wrapper.text()).toBe("load more");
  });

  it("shows the loading label and disables the button while loading", () => {
    const wrapper = mount(AppLoadMore, {
      ...globalConfig,
      props: { isLoading: true },
    });
    expect(wrapper.text()).toBe("loading…");
    expect(wrapper.find("button").attributes("disabled")).toBeDefined();
  });

  it("emits load when clicked", async () => {
    const wrapper = mount(AppLoadMore, globalConfig);
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("load")).toHaveLength(1);
  });
});
