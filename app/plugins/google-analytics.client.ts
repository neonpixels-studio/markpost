import {
  CONSENT_GRANTED,
  disableGoogleAnalytics,
  loadGoogleAnalytics,
} from "~/utils/analyticsConsent";

// GA4 only loads once the visitor has granted analytics consent. The stored
// choice is read on boot, and a later grant (banner or footer link) loads it
// without a reload.
export default defineNuxtPlugin(() => {
  const gaId = useRuntimeConfig().public.gaId;
  if (!gaId) {
    return;
  }

  const { consent, initConsent } = useAnalyticsConsent();
  initConsent();

  watch(
    consent,
    (choice) => {
      if (choice === CONSENT_GRANTED) {
        loadGoogleAnalytics(gaId);
        return;
      }
      disableGoogleAnalytics(gaId);
    },
    { immediate: true },
  );
});
