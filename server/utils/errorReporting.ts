import * as Sentry from "@sentry/nuxt";

// The one place server code talks to Sentry, so every call site stays
// testable in isolation (mock this module, or `@sentry/nuxt` directly) rather
// than reaching into the SDK itself, and so an unexpected error keeps its
// existing console.error signal while also becoming visible in production
// monitoring — which a bare console.error never provided.
//
// `message` is set as the `reportSite` tag (not just logged) because Sentry
// otherwise groups events by exception type + stack trace alone: two
// unrelated call sites raising the same underlying DB error (e.g.
// "[hooks/ingest] failed to update source stats" and "...failed to write
// ping event", both a Neon connection timeout) would collapse into a single
// issue with no way to tell which one actually fired. Tags are also
// filterable/searchable in the Sentry UI, unlike `extra`.
//
// `context` is forwarded as Sentry "extra" data, so the same detail already
// being logged (ids, delivery info, etc.) shows up on the captured event too.
export function reportError(
  message: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  console.error(message, error);

  Sentry.captureException(error, {
    tags: { reportSite: message },
    extra: context,
  });
}

// For error-level conditions that never had a thrown/caught exception to
// begin with (a data-integrity check that fails, a required field missing
// from a webhook payload) — reportError would otherwise be called with a
// context object standing in for `error`, losing both the exception (there
// isn't one) and the context (it landed in the wrong parameter). captureMessage
// groups by message text, so distinct call sites already stay distinct
// without needing the `reportSite` tag reportError adds for exceptions.
export function reportErrorCondition(
  message: string,
  context?: Record<string, unknown>,
): void {
  console.error(message, context);

  Sentry.captureMessage(message, { level: "error", extra: context });
}
