import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.stubGlobal("useHead", vi.fn());

import PrivacyPage from "../../app/pages/privacy.vue";
import TermsPage from "../../app/pages/terms.vue";
import LegalDocument from "../../app/components/LegalDocument.vue";

const options = {
  global: {
    components: { LegalDocument },
    stubs: {
      NuxtLink: { template: "<a><slot /></a>", props: ["to"] },
      TheMarketingNav: true,
      TheMarketingFooter: true,
      AppEyebrow: { template: "<span><slot /></span>" },
    },
  },
};

describe("legal pages", () => {
  it("privacy page matches snapshot", () => {
    expect(mount(PrivacyPage, options).html()).toMatchSnapshot();
  });

  it("terms page matches snapshot", () => {
    expect(mount(TermsPage, options).html()).toMatchSnapshot();
  });

  it("privacy page discloses GA is consent-gated", () => {
    expect(mount(PrivacyPage, options).text()).toContain("only if you accept");
  });
});
