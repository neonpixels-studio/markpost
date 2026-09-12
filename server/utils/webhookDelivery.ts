// signatureVerifier is the single import surface for provider identity: it
// re-exports GITHUB_PROVIDER/STRIPE_PROVIDER and owns normalizeProvider, so
// pulling all three from here keeps this module on the same literals the HMAC
// dispatch uses.
import {
  GITHUB_PROVIDER,
  normalizeProvider,
  STRIPE_PROVIDER,
} from "./signatureVerifier";

// GitHub stamps every delivery (including retries of the same delivery) with a
// stable UUID in this header, so it is the natural idempotency key for GitHub
// sources. Exported so the hooks endpoint reads the same literal it extracts by.
//
// Security note: unlike Stripe's event id (which lives inside the HMAC-signed
// body), x-github-delivery is an unauthenticated header outside the signature.
// So this dedup guard prevents duplicates from GitHub's own honest retries — it
// is NOT a replay-prevention control: an attacker replaying a captured signed
// body can vary this header to force new records. Replay was already possible
// before this guard; documented so the asymmetry with Stripe is explicit.
export const GITHUB_DELIVERY_HEADER = "x-github-delivery";

// GitHub stamps every delivery with the event type it represents (push, issues,
// ping, ...). The hooks endpoint only needs to recognize one value here: `ping`,
// the automatic delivery GitHub fires the moment a webhook is created to confirm
// the endpoint is reachable. Its body carries no user content (just a `zen`
// string and hook/repository metadata) — a delivery recognized as a ping is
// routed away from parseWebhookPayload before it can fall back to an empty
// "Untitled" record.
//
// Security note: like x-github-delivery above, this header sits outside
// X-Hub-Signature-256 — GitHub's HMAC covers the raw body only, not headers —
// so it must never be trusted alone to *discard* a delivery (as opposed to
// x-github-delivery's dedup use, where an unsigned header only risks an extra
// record). A correctly signed real delivery with this header rewritten to
// `ping` by anything between GitHub and this app (a misconfigured proxy, a
// compromised edge) would otherwise be silently dropped with a 200 GitHub
// never retries. isGithubPingEvent below closes that by additionally requiring
// the body to actually look like GitHub's ping payload (`zen` + `hook_id`),
// which a header rewrite alone can't forge.
export const GITHUB_EVENT_HEADER = "x-github-event";
const GITHUB_PING_EVENT_NAME = "ping";
const GITHUB_PING_ZEN_FIELD = "zen";
const GITHUB_PING_HOOK_ID_FIELD = "hook_id";

function hasGithubPingShape(payload: Record<string, unknown>): boolean {
  return (
    typeof payload[GITHUB_PING_ZEN_FIELD] === "string" &&
    payload[GITHUB_PING_HOOK_ID_FIELD] !== undefined
  );
}

// True only for a GitHub source's ping delivery: the provider must be GitHub
// (not just the header — a non-GitHub source forwarding an `x-github-event:
// ping` header isn't affected, pings are a GitHub-specific concept), the
// event header must say `ping`, AND the body must have the shape only GitHub's
// own ping payload carries. All three gates must agree — see the security note
// above for why the body-shape check exists alongside the header.
export function isGithubPingEvent(
  provider: string | null,
  headers: Record<string, string | undefined>,
  payload: Record<string, unknown>,
): boolean {
  if (normalizeProvider(provider) !== GITHUB_PROVIDER) {
    return false;
  }

  if (
    headers[GITHUB_EVENT_HEADER]?.trim().toLowerCase() !==
    GITHUB_PING_EVENT_NAME
  ) {
    return false;
  }

  return hasGithubPingShape(payload);
}

// Cap the extracted id well under Postgres' btree row-size limit (~2704 bytes):
// a pathologically long id (e.g. a hostile multi-KB Stripe `id`) would otherwise
// throw "index row size exceeds btree maximum" on insert, 500, and drive an
// infinite provider retry loop. Past this length we return null so ingest
// degrades to a normal (un-deduped) insert instead of crashing. Real Stripe ids
// and GitHub delivery UUIDs are far shorter.
const MAX_DELIVERY_ID_LENGTH = 255;

// Stripe's event envelope carries a stable `id` (e.g. `evt_...`) that is
// unchanged across the automatic retries Stripe fires on any non-2xx or
// timeout, so it is the idempotency key for Stripe sources.
const STRIPE_EVENT_ID_FIELD = "id";

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  // An over-long id is anomalous (real provider ids are short), and dropping it
  // silently downgrades this delivery to a non-idempotent insert — so surface it
  // for operators rather than letting the guarantee vanish without a trace. An
  // absent id (length 0) is the normal slug-only case and stays quiet.
  if (trimmed.length > MAX_DELIVERY_ID_LENGTH) {
    console.warn(
      `[hooks/delivery] delivery id exceeds ${MAX_DELIVERY_ID_LENGTH} chars; skipping dedup for this delivery`,
    );
    return null;
  }

  return trimmed;
}

function stripeDeliveryId(payload: Record<string, unknown>): string | null {
  return nonEmptyString(payload[STRIPE_EVENT_ID_FIELD]);
}

function githubDeliveryId(
  headers: Record<string, string | undefined>,
): string | null {
  return nonEmptyString(headers[GITHUB_DELIVERY_HEADER]);
}

// Returns the per-source delivery/event id a provider re-sends on retry, or
// null when the source has no such id (slug-only sources, or a provider whose
// payload/headers didn't carry one). A null id means "cannot dedupe" — the
// caller falls back to a normal insert, preserving pre-idempotency behavior.
// Isolated here so each provider's payload/header shape is testable without the
// HTTP handler and so a new provider adds one branch in one place.
export function extractDeliveryId(
  provider: string | null,
  headers: Record<string, string | undefined>,
  payload: Record<string, unknown>,
): string | null {
  const normalized = normalizeProvider(provider);

  if (normalized === STRIPE_PROVIDER) {
    return stripeDeliveryId(payload);
  }

  if (normalized === GITHUB_PROVIDER) {
    return githubDeliveryId(headers);
  }

  return null;
}
