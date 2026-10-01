import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { useAnalyticsConsent } from "../../app/composables/useAnalyticsConsent";

vi.stubGlobal("useRuntimeConfig", () => ({ public: { gaId: "G-TEST123" } }));
vi.stubGlobal("useAnalyticsConsent", useAnalyticsConsent);

import TheMarketingFooter from "../../app/components/TheMarketingFooter.vue";

const mountFooter = () =>
  mount(TheMarketingFooter, {
    global: {
      stubs: {
        NuxtLink: {
          template: "<a :href='to'><slot /></a>",
          props: ["to"],
        },
        AppLogo: true,
        AppBadge: true,
      },
    },
  });

describe("TheMarketingFooter", () => {
  it("matches snapshot", () => {
    expect(mountFooter().html()).toMatchSnapshot();
  });

  it("links to privacy and terms", () => {
    const hrefs = mountFooter()
      .findAll("a")
      .map((link) => link.attributes("href"));
    expect(hrefs).toContain("/privacy");
    expect(hrefs).toContain("/terms");
  });

  it("reopens the consent prompt from the cookie settings button", async () => {
    const { isPromptOpen } = useAnalyticsConsent();
    isPromptOpen.value = false;
    await mountFooter().find("button").trigger("click");
    expect(isPromptOpen.value).toBe(true);
  });
});
