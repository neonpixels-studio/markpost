import { describe, it, expect, beforeEach } from "vitest";
import {
  GA_SCRIPT_ELEMENT_ID,
  disableGoogleAnalytics,
  loadGoogleAnalytics,
  parseStoredConsent,
  readStoredConsent,
  writeStoredConsent,
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
    const globals = window as unknown as Record<string, unknown>;
    delete globals.dataLayer;
    delete globals.gtag;
    delete globals[`ga-disable-${GA_ID}`];
  });

  it("removes _ga cookies when analytics is disabled", () => {
    document.cookie = "_ga=abc; path=/";
    document.cookie = "_ga_TEST123=def; path=/";
    document.cookie = "keep=1; path=/";
    disableGoogleAnalytics(GA_ID);
    expect(document.cookie).not.toContain("_ga");
    expect(document.cookie).toContain("keep=1");
  });

  it("also expires _ga cookies for each parent domain", () => {
    const happyDOM = (
      window as unknown as { happyDOM: { setURL: (url: string) => void } }
    ).happyDOM;
    happyDOM.setURL("https://app.markpost.dev/");
    const writes: string[] = [];
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "_ga=abc",
      set: (value: string) => writes.push(value),
    });
    try {
      disableGoogleAnalytics(GA_ID);
    } finally {
      delete (document as unknown as Record<string, unknown>).cookie;
      happyDOM.setURL("http://localhost:3000/");
    }
    expect(writes.some((write) => write.includes("domain=.markpost.dev"))).toBe(
      true,
    );
    expect(
      writes.some((write) => write.includes("domain=.app.markpost.dev")),
    ).toBe(true);
    expect(writes.every((write) => write.includes("max-age=0"))).toBe(true);
  });

  it("tolerates blocked storage", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(readStoredConsent()).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
    expect(() => {
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error("blocked");
      };
      try {
        writeStoredConsent("granted");
      } finally {
        Storage.prototype.setItem = originalSet;
      }
    }).not.toThrow();
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
