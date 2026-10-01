import { describe, it, expect, beforeEach } from "vitest";
import {
  GA_SCRIPT_ELEMENT_ID,
  disableGoogleAnalytics,
  loadGoogleAnalytics,
  parseStoredConsent,
} from "../../app/utils/analyticsConsent";

const GA_ID = "G-TEST123";

// happy-dom logs (does not throw) when a <script src> is attached; treat the
// blocked load as success so the output stays quiet.
(
  window as unknown as {
    happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: boolean } };
  }
).happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;

describe("parseStoredConsent", () => {
  it("accepts only the two known choices", () => {
    expect(parseStoredConsent("granted")).toBe("granted");
    expect(parseStoredConsent("denied")).toBe("denied");
    expect(parseStoredConsent("yes")).toBeNull();
    expect(parseStoredConsent(null)).toBeNull();
  });
});

describe("loadGoogleAnalytics", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    delete (window as unknown as Record<string, unknown>).dataLayer;
  });

  it("injects the gtag script once and configures the id", () => {
    loadGoogleAnalytics(GA_ID);
    loadGoogleAnalytics(GA_ID);

    const scripts = document.head.querySelectorAll(`#${GA_SCRIPT_ELEMENT_ID}`);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute("src")).toBe(
      `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`,
    );
    const dataLayer = (window as unknown as { dataLayer: unknown[][] })
      .dataLayer;
    const configCalls = dataLayer.filter((entry) => entry[0] === "config");
    expect(configCalls).toHaveLength(1);
  });

  it("sets and clears Google's opt-out flag", () => {
    const flag = `ga-disable-${GA_ID}`;
    disableGoogleAnalytics(GA_ID);
    expect((window as unknown as Record<string, unknown>)[flag]).toBe(true);
    loadGoogleAnalytics(GA_ID);
    expect((window as unknown as Record<string, unknown>)[flag]).toBe(false);
  });
});
