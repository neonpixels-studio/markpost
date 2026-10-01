import { describe, it, expect, vi, beforeEach } from "vitest";
import { watch } from "vue";
import { useAnalyticsConsent } from "../../app/composables/useAnalyticsConsent";
import {
  GA_SCRIPT_ELEMENT_ID,
  STORAGE_KEY_ANALYTICS_CONSENT,
} from "../../app/utils/analyticsConsent";

const GA_ID = "G-TEST123";

// happy-dom logs (does not throw) when a <script src> is attached; treat the
// blocked load as success so the output stays quiet.
(
  window as unknown as {
    happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: boolean } };
  }
).happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
let gaId = GA_ID;

vi.stubGlobal("defineNuxtPlugin", (plugin: () => void) => plugin);
vi.stubGlobal("useRuntimeConfig", () => ({ public: { gaId } }));
vi.stubGlobal("useAnalyticsConsent", useAnalyticsConsent);
vi.stubGlobal("watch", watch);

const { default: runPlugin } =
  (await import("../../app/plugins/google-analytics.client")) as unknown as {
    default: () => void;
  };

const gaScript = () => document.getElementById(GA_SCRIPT_ELEMENT_ID);

describe("google-analytics plugin", () => {
  beforeEach(() => {
    gaId = GA_ID;
    document.head.innerHTML = "";
    localStorage.clear();
    useAnalyticsConsent().consent.value = null;
  });

  it("does not inject GA without a stored choice", () => {
    runPlugin();
    expect(gaScript()).toBeNull();
  });

  it("does not inject GA when consent was declined", () => {
    localStorage.setItem(STORAGE_KEY_ANALYTICS_CONSENT, "denied");
    runPlugin();
    expect(gaScript()).toBeNull();
  });

  it("injects GA when consent was previously granted", () => {
    localStorage.setItem(STORAGE_KEY_ANALYTICS_CONSENT, "granted");
    runPlugin();
    expect(gaScript()?.getAttribute("src")).toContain(GA_ID);
  });

  it("injects GA after consent is granted later, and persists it", async () => {
    runPlugin();
    useAnalyticsConsent().grantConsent();
    await nextTick();
    expect(gaScript()).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY_ANALYTICS_CONSENT)).toBe("granted");
  });

  it("does nothing when no GA id is configured", () => {
    gaId = "";
    localStorage.setItem(STORAGE_KEY_ANALYTICS_CONSENT, "granted");
    runPlugin();
    expect(gaScript()).toBeNull();
  });
});
