import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import {
  CONSENT_DENIED,
  CONSENT_GRANTED,
  STORAGE_KEY_ANALYTICS_CONSENT,
} from "../../app/utils/analyticsConsent";
import { useAnalyticsConsent } from "../../app/composables/useAnalyticsConsent";

let gaId = "G-TEST123";
vi.stubGlobal("useRuntimeConfig", () => ({ public: { gaId } }));
vi.stubGlobal("useAnalyticsConsent", useAnalyticsConsent);

import AnalyticsConsentBanner from "../../app/components/AnalyticsConsentBanner.vue";

const mountBanner = () =>
  mount(AnalyticsConsentBanner, {
    global: {
      stubs: {
        NuxtLink: { template: "<a><slot /></a>", props: ["to"] },
        AppBtn: { template: "<button><slot /></button>" },
      },
    },
  });

describe("AnalyticsConsentBanner", () => {
  beforeEach(() => {
    gaId = "G-TEST123";
    localStorage.clear();
    useAnalyticsConsent().initConsent();
  });

  it("matches snapshot when no choice is stored", () => {
    expect(mountBanner().html()).toMatchSnapshot();
  });

  it("is hidden once a choice is stored, and reopens on demand", async () => {
    const wrapper = mountBanner();
    await wrapper.findAll("button")[1]!.trigger("click");
    expect(wrapper.find("section").exists()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY_ANALYTICS_CONSENT)).toBe(
      CONSENT_GRANTED,
    );

    useAnalyticsConsent().reopenPrompt();
    await wrapper.vm.$nextTick();
    expect(wrapper.find("section").exists()).toBe(true);
  });

  it("stores a decline", async () => {
    const wrapper = mountBanner();
    await wrapper.findAll("button")[0]!.trigger("click");
    expect(localStorage.getItem(STORAGE_KEY_ANALYTICS_CONSENT)).toBe(
      CONSENT_DENIED,
    );
  });

  it("renders nothing without a GA id", () => {
    gaId = "";
    expect(mountBanner().find("section").exists()).toBe(false);
  });
});
