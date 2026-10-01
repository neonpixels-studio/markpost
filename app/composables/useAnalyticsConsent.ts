import {
  CONSENT_DENIED,
  CONSENT_GRANTED,
  STORAGE_KEY_ANALYTICS_CONSENT,
  parseStoredConsent,
  type AnalyticsConsent,
} from "~/utils/analyticsConsent";

// Module-level singletons shared by the plugin, banner and footer link. All
// mutations are client-only (init runs from the .client plugin).
const consent = ref<AnalyticsConsent | null>(null);
const isPromptOpen = ref(false);

export function useAnalyticsConsent() {
  const initConsent = () => {
    consent.value = parseStoredConsent(
      localStorage.getItem(STORAGE_KEY_ANALYTICS_CONSENT),
    );
    isPromptOpen.value = consent.value === null;
  };

  const setConsent = (choice: AnalyticsConsent) => {
    localStorage.setItem(STORAGE_KEY_ANALYTICS_CONSENT, choice);
    consent.value = choice;
    isPromptOpen.value = false;
  };

  const grantConsent = () => setConsent(CONSENT_GRANTED);
  const denyConsent = () => setConsent(CONSENT_DENIED);
  const reopenPrompt = () => {
    isPromptOpen.value = true;
  };

  return {
    consent,
    isPromptOpen,
    initConsent,
    grantConsent,
    denyConsent,
    reopenPrompt,
  };
}
