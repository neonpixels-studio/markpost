import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppErrorScreen from "../../app/components/AppErrorScreen.vue";
import AppTopo from "../../app/components/AppTopo.vue";
import AppLogo from "../../app/components/AppLogo.vue";
import AppIcon from "../../app/components/AppIcon.vue";

const globalConfig = {
  global: {
    components: { AppTopo, AppLogo, AppIcon },
  },
};

describe("AppErrorScreen", () => {
  it("renders the code, terminal line, heading, lead, and a home link", () => {
    const wrapper = mount(AppErrorScreen, {
      ...globalConfig,
      props: {
        seed: 3,
        code: "404",
        terminalCommand: "cat /vault/missing.md",
        terminalOutput: "cat: no such file or directory",
        heading: "This page never synced.",
        lead: "The record you're looking for isn't in the vault.",
      },
    });

    expect(wrapper.text()).toContain("404");
    expect(wrapper.text()).toContain("cat /vault/missing.md");
    expect(wrapper.text()).toContain("cat: no such file or directory");
    expect(wrapper.text()).toContain("This page never synced.");
    expect(wrapper.text()).toContain(
      "The record you're looking for isn't in the vault.",
    );

    const homeLink = wrapper.find("a[href='/']");
    expect(homeLink.exists()).toBe(true);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders slotted actions", () => {
    const wrapper = mount(AppErrorScreen, {
      ...globalConfig,
      props: {
        code: "500",
        terminalCommand: "markpost sync",
        terminalOutput: "internal error",
        heading: "Something went wrong.",
        lead: "Try again.",
      },
      slots: {
        default: '<button class="retry-btn">try again</button>',
      },
    });

    expect(wrapper.find(".retry-btn").exists()).toBe(true);
  });

  it("applies the given terminal output color", () => {
    const wrapper = mount(AppErrorScreen, {
      ...globalConfig,
      props: {
        code: "500",
        strokeColor: "var(--err)",
        terminalCommand: "markpost sync",
        terminalOutput: "internal error",
        terminalOutputColor: "var(--err)",
        heading: "Something went wrong.",
        lead: "Try again.",
      },
    });

    expect(
      wrapper.find(".code-body span:last-child").attributes("style"),
    ).toContain("color: var(--err)");
  });
});
