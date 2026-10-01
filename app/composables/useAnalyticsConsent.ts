import {
  CONSENT_DENIED,
  CONSENT_GRANTED,
  readStoredConsent,
  writeStoredConsent,
  type AnalyticsConsent,
} from "~/utils/analyticsConsent";

// Module-level singletons shared by the plugin, banner and footer link. All
// mutations are client-only (init runs from the .client plugin).
const consent = ref<AnalyticsConsent | null>(null);
const isPromptOpen = ref(false);

export function useAnalyticsConsent() {
  const initConsent = () => {
    consent.value = readStoredConsent();
    isPromptOpen.value = consent.value === null;
  };

  const setConsent = (choice: AnalyticsConsent) => {
    writeStoredConsent(choice);
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
