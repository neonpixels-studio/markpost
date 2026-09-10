import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppErrorScreen from "../../app/components/AppErrorScreen.vue";
import AppTopo from "../../app/components/AppTopo.vue";
import AppLogo from "../../app/components/AppLogo.vue";
import AppIcon from "../../app/components/AppIcon.vue";

const globalConfig = {
  global: {
    components: { AppTopo, AppLogo, AppIcon },
    stubs: {
      NuxtLink: {
        template: '<a :href="to" :data-external="external"><slot /></a>',
        props: ["to", "external"],
      },
    },
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

  it("defaults the home link to client-side navigation", () => {
    const wrapper = mount(AppErrorScreen, {
      ...globalConfig,
      props: {
        code: "404",
        terminalCommand: "cat /vault/missing.md",
        terminalOutput: "cat: no such file or directory",
        heading: "This page never synced.",
        lead: "The record you're looking for isn't in the vault.",
      },
    });

    expect(wrapper.find("a[href='/']").attributes("data-external")).toBe(
      "false",
    );
  });

  it("forces a full page load on the home link when homeExternal is set", () => {
    const wrapper = mount(AppErrorScreen, {
      ...globalConfig,
      props: {
        code: "500",
        terminalCommand: "markpost sync",
        terminalOutput: "internal error",
        heading: "Something went wrong.",
        lead: "Try again.",
        homeExternal: true,
      },
    });

    expect(wrapper.find("a[href='/']").attributes("data-external")).toBe(
      "true",
    );
  });

  it("wraps the whole terminal body so a long command can't push the page wide", () => {
    const longCommand = `cat /vault/${"a".repeat(300)}.md`;
    const wrapper = mount(AppErrorScreen, {
      ...globalConfig,
      props: {
        code: "404",
        terminalCommand: longCommand,
        terminalOutput: "cat: no such file or directory",
        heading: "This page never synced.",
        lead: "The record you're looking for isn't in the vault.",
      },
    });

    expect(wrapper.find(".code-body").attributes("style")).toContain(
      "overflow-wrap: anywhere",
    );
    expect(wrapper.text()).toContain(longCommand);
  });

  it("applies the given stroke color to the glyph via a CSS custom property", () => {
    const wrapper = mount(AppErrorScreen, {
      ...globalConfig,
      props: {
        code: "500",
        strokeColor: "var(--err)",
        terminalCommand: "markpost sync",
        terminalOutput: "internal error",
        heading: "Something went wrong.",
        lead: "Try again.",
      },
    });

    expect(wrapper.find(".err-glyph").attributes("style")).toContain(
      "--stroke-color: var(--err)",
    );
  });
});
