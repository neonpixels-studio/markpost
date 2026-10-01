export const STORAGE_KEY_ANALYTICS_CONSENT = "mp_analytics_consent";
export const CONSENT_GRANTED = "granted";
export const CONSENT_DENIED = "denied";
export const GA_SCRIPT_ELEMENT_ID = "mp-ga-script";

export type AnalyticsConsent = typeof CONSENT_GRANTED | typeof CONSENT_DENIED;

export function parseStoredConsent(
  value: string | null | undefined,
): AnalyticsConsent | null {
  if (value === CONSENT_GRANTED || value === CONSENT_DENIED) {
    return value;
  }
  return null;
}

function disableFlagName(gaId: string): string {
  return `ga-disable-${gaId}`;
}

// Idempotent: a second grant (or a re-run of the plugin) never adds a second
// gtag script or fires a second `config`.
export function loadGoogleAnalytics(gaId: string): void {
  (window as unknown as Record<string, unknown>)[disableFlagName(gaId)] = false;
  if (document.getElementById(GA_SCRIPT_ELEMENT_ID)) {
    return;
  }

  const loader = document.createElement("script");
  loader.id = GA_SCRIPT_ELEMENT_ID;
  loader.async = true;
  loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
  document.head.appendChild(loader);

  const win = window as unknown as {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  };
  win.dataLayer = win.dataLayer || [];
  win.gtag = function gtag() {
    // gtag.js expects the raw `arguments` object, not a rest array.
    // eslint-disable-next-line prefer-rest-params
    win.dataLayer.push(arguments);
  };
  win.gtag("js", new Date());
  win.gtag("config", gaId);
}

// Google's documented opt-out switch. A script already loaded this page view
// cannot be unloaded, so this stops further hits until the next page load,
// where the stored "denied" choice prevents the script loading at all.
export function disableGoogleAnalytics(gaId: string): void {
  (window as unknown as Record<string, unknown>)[disableFlagName(gaId)] = true;
}
