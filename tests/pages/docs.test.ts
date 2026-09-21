import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.stubGlobal("definePageMeta", vi.fn());

import DocsPage from "../../app/pages/docs.vue";

const globalConfig = {
  // docs.vue renders the active doc via `<component :is="currentPage.component" />`
  // where the value is already a resolved component object rather than a name
  // string, so Vue never does a name-based lookup for it and a plain named
  // entry in `global.stubs` can't intercept it. `shallow` stubs every child
  // component (matched by object identity, not name) so the eight doc body
  // components are stubbed out regardless of how they're resolved; the
  // explicit stubs below override shallow's generic auto-stub markup for the
  // components these tests assert on directly.
  shallow: true,
  global: {
    stubs: {
      NuxtLink: { template: "<a><slot /></a>", props: ["to"] },
      AppIcon: { template: "<span />" },
      AppKbd: { template: "<kbd><slot /></kbd>" },
      DocNavButton: { template: "<button />", props: ["dir", "page"] },
    },
  },
};

let activeWrapper: ReturnType<typeof mount> | null = null;

function mountDocsPage() {
  activeWrapper = mount(DocsPage, { ...globalConfig, attachTo: document.body });
  return activeWrapper;
}

describe("docs page", () => {
  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
  });

  it("matches snapshot in default state", () => {
    const wrapper = mountDocsPage();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows every nav item when the search box is empty", () => {
    const wrapper = mountDocsPage();
    expect(wrapper.findAll("nav button")).toHaveLength(8);
  });

  it("filters the sidebar nav down to items matching the search query", async () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input");
    await searchInput.setValue("auth");

    const labels = wrapper.findAll("nav button").map((button) => button.text());
    expect(labels).toEqual(["Authentication"]);
  });

  it("filtering is case-insensitive and matches on partial label text", async () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input");
    await searchInput.setValue("COMMAND");

    const labels = wrapper.findAll("nav button").map((button) => button.text());
    expect(labels).toEqual(["Command reference"]);
  });

  it("shows a no-results message when nothing matches the query", async () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input");
    await searchInput.setValue("nonexistent-topic");

    expect(wrapper.findAll("nav button")).toHaveLength(0);
    expect(wrapper.text()).toContain('No results for "nonexistent-topic"');
  });

  it("restores the full nav when the search query is cleared", async () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input");
    await searchInput.setValue("auth");
    await searchInput.setValue("");

    expect(wrapper.findAll("nav button")).toHaveLength(8);
  });

  it("clears the search query on Escape", async () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input");
    await searchInput.setValue("auth");
    await searchInput.trigger("keydown.esc");

    expect((searchInput.element as HTMLInputElement).value).toBe("");
    expect(wrapper.findAll("nav button")).toHaveLength(8);
  });

  it("links the GitHub icon to the real markpost repository", () => {
    const wrapper = mountDocsPage();
    const githubLink = wrapper.find("a.icon-btn");
    expect(githubLink.attributes("href")).toBe(
      "https://github.com/neonpixels-studio/markpost",
    );
  });

  it("focuses the search input when '/' is pressed outside a text field", () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input").element as HTMLInputElement;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));

    expect(document.activeElement).toBe(searchInput);
  });

  it("does not hijack '/' while the user is already typing in another field", () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input").element as HTMLInputElement;
    const otherInput = document.createElement("input");
    document.body.appendChild(otherInput);
    otherInput.focus();

    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true });
    otherInput.dispatchEvent(event);

    expect(document.activeElement).not.toBe(searchInput);
    expect(document.activeElement).toBe(otherInput);
    otherInput.remove();
  });

  it("stops listening for the '/' shortcut after being unmounted", () => {
    const wrapper = mountDocsPage();
    wrapper.unmount();
    activeWrapper = null;

    expect(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" })),
    ).not.toThrow();
  });
});
