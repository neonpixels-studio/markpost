import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.stubGlobal("definePageMeta", vi.fn());

import DocsPage from "../../app/pages/docs.vue";
import { DOC_NAV } from "../../app/utils/docNav";

const TOTAL_NAV_ITEMS = DOC_NAV.flatMap((group) => group.items).length;
const REPO_URL = "https://github.com/neonpixels-studio/markpost";

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
let strayElement: HTMLElement | null = null;

function mountDocsPage() {
  activeWrapper = mount(DocsPage, { ...globalConfig, attachTo: document.body });
  return activeWrapper;
}

// Creates and focuses an element outside the docs page, for shortcut-guard
// tests. Tracked on a module-level variable so afterEach always removes it,
// even if the test's assertions fail first.
function focusOutsideField(tagName: "input" | "select"): HTMLElement {
  strayElement = document.createElement(tagName);
  document.body.appendChild(strayElement);
  strayElement.focus();
  return strayElement;
}

describe("docs page", () => {
  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
    strayElement?.remove();
    strayElement = null;
    vi.restoreAllMocks();
  });

  it("matches snapshot in default state", () => {
    const wrapper = mountDocsPage();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows every nav item when the search box is empty", () => {
    const wrapper = mountDocsPage();
    expect(wrapper.findAll("nav button")).toHaveLength(TOTAL_NAV_ITEMS);
  });

  it("shows every nav item when the search query is only whitespace", async () => {
    const wrapper = mountDocsPage();
    await wrapper.find("input").setValue("   ");
    expect(wrapper.findAll("nav button")).toHaveLength(TOTAL_NAV_ITEMS);
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

  it("keeps every item in a group whose group name matches the query", async () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input");
    await searchInput.setValue("cli");

    // "cli" matches the "CLI" group name, not either item's label, so a
    // query that only matched item labels would wrongly report no results.
    const labels = wrapper.findAll("nav button").map((button) => button.text());
    expect(labels).toEqual(["Command reference", "Markdown & frontmatter"]);
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

    expect(wrapper.findAll("nav button")).toHaveLength(TOTAL_NAV_ITEMS);
  });

  it("clears the search query on Escape and keeps focus in the search box", async () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input");
    (searchInput.element as HTMLInputElement).focus();
    await searchInput.setValue("auth");
    await searchInput.trigger("keydown.esc");

    expect((searchInput.element as HTMLInputElement).value).toBe("");
    expect(wrapper.findAll("nav button")).toHaveLength(TOTAL_NAV_ITEMS);
    expect(document.activeElement).toBe(searchInput.element);
  });

  it("links the header GitHub icon to the real markpost repository", () => {
    const wrapper = mountDocsPage();
    expect(wrapper.find("a.icon-btn").attributes("href")).toBe(REPO_URL);
  });

  it("links every GitHub affordance on the page to the real repository", () => {
    const wrapper = mountDocsPage();
    const githubHrefs = wrapper
      .findAll("a")
      .map((link) => link.attributes("href"))
      .filter((href): href is string => !!href?.includes("github.com"));

    expect(githubHrefs.length).toBeGreaterThan(0);
    for (const href of githubHrefs) {
      expect(href).toBe(REPO_URL);
    }
  });

  it("focuses the search input when '/' is pressed outside a text field", () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input").element as HTMLInputElement;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));

    expect(document.activeElement).toBe(searchInput);
  });

  it("ignores '/' combined with a modifier key, e.g. Cmd+/, Ctrl+/, or Alt+/", () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input").element as HTMLInputElement;

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", metaKey: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", ctrlKey: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", altKey: true }),
    );

    expect(document.activeElement).not.toBe(searchInput);
  });

  it("ignores '/' typed while an IME composition is in progress", () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input").element as HTMLInputElement;

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", isComposing: true }),
    );

    expect(document.activeElement).not.toBe(searchInput);
  });

  it("does not hijack '/' while the user is already typing in another input", () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input").element as HTMLInputElement;
    const otherInput = focusOutsideField("input");

    otherInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    );

    expect(document.activeElement).toBe(otherInput);
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("does not hijack '/' while a <select> has focus (native type-ahead)", () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input").element as HTMLInputElement;
    const otherSelect = focusOutsideField("select");

    otherSelect.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    );

    expect(document.activeElement).toBe(otherSelect);
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("does not hijack '/' while a contenteditable element has focus", () => {
    const wrapper = mountDocsPage();
    const searchInput = wrapper.find("input").element as HTMLInputElement;
    strayElement = document.createElement("div");
    // jsdom/happy-dom don't compute isContentEditable from the attribute, so
    // set the property directly to exercise the same branch the browser does.
    Object.defineProperty(strayElement, "isContentEditable", { value: true });
    document.body.appendChild(strayElement);
    strayElement.focus();

    strayElement.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    );

    expect(document.activeElement).not.toBe(searchInput);
  });

  it("removes the '/' shortcut listener when unmounted", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const wrapper = mountDocsPage();
    const keydownCall = addSpy.mock.calls.find(([type]) => type === "keydown");
    expect(keydownCall).toBeDefined();
    const handler = keydownCall?.[1];

    const removeSpy = vi.spyOn(window, "removeEventListener");
    wrapper.unmount();
    activeWrapper = null;

    expect(removeSpy).toHaveBeenCalledWith("keydown", handler);
  });
});
