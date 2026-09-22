import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import AppIcon from "../../app/components/AppIcon.vue";
import AppBadge from "../../app/components/AppBadge.vue";
import AppKbd from "../../app/components/AppKbd.vue";
import AppLogo from "../../app/components/AppLogo.vue";
import AppPlanCard from "../../app/components/AppPlanCard.vue";
import AppRecordSearch from "../../app/components/AppRecordSearch.vue";
import type { RecordResource } from "../../app/composables/useRecords";
import type { BillingUsage } from "../../app/composables/useBillingUsage";

const mockUserRef = ref({
  firstName: "Dan",
  lastName: "Holloran",
  primaryEmailAddress: { emailAddress: "dan@markpost.io" },
});
vi.stubGlobal("useUser", () => ({ user: mockUserRef }));

const mockNavigateTo = vi.fn();
vi.stubGlobal("navigateTo", mockNavigateTo);

const mockFetchRecordStats = vi.fn();
vi.mock("~/composables/useRecords", () => ({
  fetchRecordStats: (...args: unknown[]) => mockFetchRecordStats(...args),
}));

const mockFetchBillingUsage = vi.fn();
vi.mock("~/composables/useBillingUsage", async () => {
  const actual = await vi.importActual<
    typeof import("../../app/composables/useBillingUsage")
  >("../../app/composables/useBillingUsage");

  return {
    ...actual,
    fetchBillingUsage: (...args: unknown[]) => mockFetchBillingUsage(...args),
  };
});

const mockSearchQuery = ref("");
const mockSearchResults = ref<RecordResource[]>([]);
const mockClearResults = vi.fn(() => {
  mockSearchResults.value = [];
});
vi.mock("~/composables/useRecordSearch", () => ({
  useRecordSearch: () => ({
    query: mockSearchQuery,
    results: mockSearchResults,
    clearResults: mockClearResults,
  }),
}));

import TheAppShell from "../../app/components/TheAppShell.vue";

const globalConfig = {
  global: {
    components: {
      AppIcon,
      AppBadge,
      AppKbd,
      AppLogo,
      AppPlanCard,
      AppRecordSearch,
    },
    stubs: {
      NuxtLink: {
        template: '<a :href="to"><slot /></a>',
        props: ["to"],
      },
    },
  },
};

function makeRecord(overrides: Partial<RecordResource["attributes"]> = {}) {
  return {
    type: "records" as const,
    id: "uuid-1",
    attributes: {
      uuid: "uuid-1",
      createdAt: "2026-06-27T10:00:00Z",
      userId: "user-1",
      title: "Test Record",
      content: "Content here",
      sourceId: null,
      source: "webhook/github",
      status: "synced" as const,
      filePath: "99-incoming/test.md",
      tags: null,
      frontmatter: null,
      syncedAt: null,
      errorMessage: null,
      ...overrides,
    },
    links: { self: "/api/records/uuid-1" },
  };
}

const trialingUsage: BillingUsage = {
  recordsCreatedThisMonth: 284,
  connectedSourceCount: 2,
  plan: "pro",
  status: "trialing",
  trialEndsAt: "2026-07-10T00:00:00Z",
  trialDaysLeft: 9,
  trialPercentElapsed: 64,
};

let activeWrapper: ReturnType<typeof mount> | null = null;

function mountShell() {
  activeWrapper = mount(TheAppShell, {
    ...globalConfig,
    props: { active: "inbox", title: "Inbox" },
    attachTo: document.body,
  });
  return activeWrapper;
}

describe("TheAppShell", () => {
  beforeEach(() => {
    mockFetchRecordStats.mockReset();
    mockFetchRecordStats.mockResolvedValue({
      syncedToday: 1,
      pending: 3,
      errors: 0,
      thisMonth: 10,
    });
    mockFetchBillingUsage.mockReset();
    mockFetchBillingUsage.mockResolvedValue(trialingUsage);
    mockSearchQuery.value = "";
    mockSearchResults.value = [];
    mockClearResults.mockClear();
    mockNavigateTo.mockClear();
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
    document.documentElement.classList.remove("dark");
    document.body.innerHTML = "";
  });

  it("matches snapshot once data has loaded", async () => {
    const wrapper = mountShell();
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });

  // Guards the compact icon rail (app/components/TheAppShell.vue's
  // ≤1024px breakpoint): the visible nav label text is visually hidden
  // there via CSS, not removed from the DOM, so each link keeps an
  // accessible name. jsdom doesn't evaluate media queries, so nothing else
  // in this file would catch the label markup (or the title fallback)
  // being dropped by accident.
  describe("nav accessibility", () => {
    it("keeps an .app-shell__nav-label with the item's text for every nav link", async () => {
      const wrapper = mountShell();
      await flushPromises();

      for (const navItem of [
        { label: "Inbox", path: "/inbox" },
        { label: "Sources", path: "/sources" },
        { label: "Activity", path: "/activity" },
        { label: "Settings", path: "/settings" },
      ]) {
        const link = wrapper.find(`a[href="${navItem.path}"]`);
        expect(link.exists()).toBe(true);
        expect(link.find(".app-shell__nav-label").text()).toBe(navItem.label);
      }
    });

    it("sets a title on each nav link so icon-only mode keeps a hover label", async () => {
      const wrapper = mountShell();
      await flushPromises();

      const sourcesLink = wrapper.find('a[href="/sources"]');
      expect(sourcesLink.attributes("title")).toBe("Sources");
    });

    it("includes the pending count in the inbox link's title", async () => {
      const wrapper = mountShell();
      await flushPromises();

      const inboxLink = wrapper.find('a[href="/inbox"]');
      expect(inboxLink.attributes("title")).toBe("Inbox (3)");
    });
  });

  describe("inbox badge", () => {
    it("shows the pending record count from the stats endpoint", async () => {
      const wrapper = mountShell();
      await flushPromises();
      expect(mockFetchRecordStats).toHaveBeenCalledOnce();
      expect(wrapper.find(".badge.accent").text()).toBe("3");
    });

    it("hides the badge when there are no pending records", async () => {
      mockFetchRecordStats.mockResolvedValue({
        syncedToday: 1,
        pending: 0,
        errors: 0,
        thisMonth: 10,
      });
      const wrapper = mountShell();
      await flushPromises();
      const inboxLink = wrapper
        .findAll("a")
        .find((link) => link.text().includes("Inbox"));
      expect(inboxLink?.find(".badge").exists()).toBe(false);
    });

    it("falls back to the plain label in the title when there's no pending count", async () => {
      mockFetchRecordStats.mockResolvedValue({
        syncedToday: 1,
        pending: 0,
        errors: 0,
        thisMonth: 10,
      });
      const wrapper = mountShell();
      await flushPromises();
      const inboxLink = wrapper.find('a[href="/inbox"]');
      expect(inboxLink.attributes("title")).toBe("Inbox");
    });
  });

  describe("plan card", () => {
    it("shows the plan badge and days left while trialing", async () => {
      const wrapper = mountShell();
      await flushPromises();
      expect(wrapper.text()).toContain("pro trial");
      expect(wrapper.text()).toContain("9d left");
    });

    it("renders the trial progress bar width from the API", async () => {
      const wrapper = mountShell();
      await flushPromises();
      const bar = wrapper.find('div[style*="var(--accent)"]');
      expect(bar.attributes("style")).toContain("width: 64%");
    });

    it("hides days-left and the progress bar for an active (non-trial) plan", async () => {
      mockFetchBillingUsage.mockResolvedValue({
        recordsCreatedThisMonth: 284,
        connectedSourceCount: 2,
        plan: "pro",
        status: "active",
        trialEndsAt: null,
        trialDaysLeft: null,
        trialPercentElapsed: null,
      });
      const wrapper = mountShell();
      await flushPromises();
      expect(wrapper.text()).toContain("pro");
      expect(wrapper.text()).not.toContain("d left");
      expect(wrapper.find('div[style*="var(--accent)"]').exists()).toBe(false);
    });

    it("defaults to the hobby plan when the usage fetch fails", async () => {
      mockFetchBillingUsage.mockResolvedValue(null);
      const wrapper = mountShell();
      await flushPromises();
      expect(wrapper.text()).toContain("hobby");
    });
  });

  describe("header search", () => {
    it("shows a dropdown of results while focused with matches", async () => {
      mockSearchResults.value = [makeRecord({ title: "Invoice #42" })];
      const wrapper = mountShell();
      await flushPromises();
      await wrapper.find("input.input").trigger("focus");
      await flushPromises();
      expect(wrapper.text()).toContain("Invoice #42");
    });

    it("does not show the dropdown when there are no results", async () => {
      mockSearchResults.value = [];
      const wrapper = mountShell();
      await flushPromises();
      await wrapper.find("input.input").trigger("focus");
      await flushPromises();
      expect(wrapper.find(".card").exists()).toBe(false);
    });

    it("navigates to the record and closes the dropdown when a result is clicked", async () => {
      mockSearchResults.value = [makeRecord({ uuid: "record-42" })];
      const wrapper = mountShell();
      await flushPromises();
      const input = wrapper.find("input.input");
      await input.trigger("focus");
      await flushPromises();

      await wrapper.find(".card button").trigger("click");

      expect(mockNavigateTo).toHaveBeenCalledWith("/inbox?record=record-42");
      expect(mockClearResults).toHaveBeenCalled();
    });

    it("selects the top result on Enter", async () => {
      mockSearchResults.value = [makeRecord({ uuid: "record-top" })];
      const wrapper = mountShell();
      await flushPromises();
      const input = wrapper.find("input.input");
      await input.trigger("focus");
      await input.trigger("keydown.enter");

      expect(mockNavigateTo).toHaveBeenCalledWith("/inbox?record=record-top");
    });

    it("does nothing on Enter when there are no results", async () => {
      mockSearchResults.value = [];
      const wrapper = mountShell();
      await flushPromises();
      const input = wrapper.find("input.input");
      await input.trigger("focus");
      await input.trigger("keydown.enter");

      expect(mockNavigateTo).not.toHaveBeenCalled();
    });

    it("clears the query and blurs on Escape", async () => {
      mockSearchQuery.value = "test";
      mockSearchResults.value = [makeRecord()];
      const wrapper = mountShell();
      await flushPromises();
      const input = wrapper.find("input.input");
      await input.trigger("focus");
      await input.trigger("keydown.esc");

      expect(mockSearchQuery.value).toBe("");
      expect(mockClearResults).toHaveBeenCalled();
    });

    it("focuses the search input on Cmd+K", async () => {
      const wrapper = mountShell();
      await flushPromises();
      const input = wrapper.find("input.input").element as HTMLInputElement;

      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true }),
      );

      expect(document.activeElement).toBe(input);
    });
  });

  describe("notifications bell", () => {
    it("navigates to the activity feed when clicked", async () => {
      const wrapper = mountShell();
      await flushPromises();
      await wrapper.find("button[title='view activity']").trigger("click");
      expect(mockNavigateTo).toHaveBeenCalledWith("/activity");
    });
  });
});
