import * as Sentry from "@sentry/nuxt";

// A single underlying failure can be caught and logged more than once before
// it either reaches apiErrorHandler or gets swallowed for good (e.g. a
// low-level DB write failure re-caught by a higher-level "best effort, don't
// fail the request" wrapper). Tracking already-reported error objects here
// means the innermost, most context-rich call site wins and one real failure
// never produces two Sentry events. Non-object "errors" (a thrown string,
// undefined, etc.) can't be tracked by identity and are always re-reported —
// they're rare enough, and cheap enough, not to bother with.
const reportedErrors = new WeakSet<object>();

function isTrackable(error: unknown): error is object {
  return typeof error === "object" && error !== null;
}

function alreadyReported(error: unknown): boolean {
  return isTrackable(error) && reportedErrors.has(error);
}

function markReported(error: unknown): void {
  if (isTrackable(error)) {
    reportedErrors.add(error);
  }
}

// The one place server code talks to Sentry, so every call site stays
// testable in isolation (mock this module, or `@sentry/nuxt` directly) rather
// than reaching into the SDK itself, and so an unexpected error keeps its
// existing console.error signal while also becoming visible in production
// monitoring — which a bare console.error never provided. `context` is
// forwarded as Sentry "extra" data, so the same detail already being logged
// (ids, delivery info, etc.) shows up on the captured event too.
export function reportError(
  message: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  console.error(message, error);

  if (alreadyReported(error)) {
    return;
  }
  markReported(error);

  Sentry.captureException(error, context ? { extra: context } : undefined);
}
