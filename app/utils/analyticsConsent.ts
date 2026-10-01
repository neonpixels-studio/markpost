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

type GtagWindow = Window & {
  dataLayer: unknown[];
  gtag: (...args: unknown[]) => void;
};

const GA_COOKIE_PREFIX = "_ga";
const EPOCH_UTC = "Thu, 01 Jan 1970 00:00:00 GMT";

export function readStoredConsent(): AnalyticsConsent | null {
  try {
    return parseStoredConsent(
      localStorage.getItem(STORAGE_KEY_ANALYTICS_CONSENT),
    );
  } catch {
    return null;
  }
}

// Storage can be blocked (privacy modes); the choice still applies for this
// session via the in-memory ref, it just won't persist.
export function writeStoredConsent(choice: AnalyticsConsent): void {
  try {
    localStorage.setItem(STORAGE_KEY_ANALYTICS_CONSENT, choice);
  } catch {
    // intentionally ignored, see above
  }
}

function cookieDomainCandidates(): string[] {
  const parts = location.hostname.split(".");
  return parts
    .slice(0, -1)
    .map((_, index) => `.${parts.slice(index).join(".")}`);
}

// GA sets its cookies on the registrable parent domain, so expire the name for
// the host and every parent suffix.
function expireCookie(name: string): void {
  const expiry = `${name}=; max-age=0; expires=${EPOCH_UTC}; path=/`;
  document.cookie = expiry;
  cookieDomainCandidates().forEach((domain) => {
    document.cookie = `${expiry}; domain=${domain}`;
  });
}

function clearGoogleAnalyticsCookies(): void {
  document.cookie
    .split(";")
    .map((pair) => pair.split("=")[0]?.trim() ?? "")
    .filter((name) => name.startsWith(GA_COOKIE_PREFIX))
    .forEach(expireCookie);
}

function disableFlagName(gaId: string): string {
  return `ga-disable-${gaId}`;
}

function setDisableFlag(gaId: string, disabled: boolean): void {
  (window as unknown as Record<string, unknown>)[disableFlagName(gaId)] =
    disabled;
}

function injectGtagScript(gaId: string): void {
  const loader = document.createElement("script");
  loader.id = GA_SCRIPT_ELEMENT_ID;
  loader.async = true;
  loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
  document.head.appendChild(loader);
}

function bootstrapGtag(gaId: string): void {
  const analyticsWindow = window as unknown as GtagWindow;
  analyticsWindow.dataLayer = analyticsWindow.dataLayer || [];
  analyticsWindow.gtag =
    analyticsWindow.gtag ||
    function gtag() {
      // gtag.js expects the raw `arguments` object, not a rest array.
      // eslint-disable-next-line prefer-rest-params
      analyticsWindow.dataLayer.push(arguments);
    };
  analyticsWindow.gtag("js", new Date());
  analyticsWindow.gtag("config", gaId);
}

// Idempotent: a second grant (or a re-run of the plugin) never adds a second
// gtag script or fires a second `config`.
export function loadGoogleAnalytics(gaId: string): void {
  setDisableFlag(gaId, false);
  if (document.getElementById(GA_SCRIPT_ELEMENT_ID)) {
    return;
  }
  injectGtagScript(gaId);
  bootstrapGtag(gaId);
}

// Google's documented opt-out switch. A script already loaded this page view
// cannot be unloaded, so this stops further hits until the next page load,
// where the stored "denied" choice prevents the script loading at all.
export function disableGoogleAnalytics(gaId: string): void {
  setDisableFlag(gaId, true);
  clearGoogleAnalyticsCookies();
}
