import { and, eq, isNull } from "drizzle-orm";
import type { H3Event } from "h3";
import { getDb } from "../db";
import { apiTokens } from "../db/schema";
import { hashToken, isApiToken, isTokenExpired } from "../utils/tokens";
import { refreshTokenLastUsedAt } from "../utils/tokenUsage";
import { ensureUserRegistered } from "../utils/auth";
import { getClerkClient } from "../utils/clerk";
import {
  apiErrorHandler,
  throwUnauthorized,
  tooManyRequestsError,
} from "../utils/errors";
import { recordAuthedApiHit } from "../utils/apiThrottle";
import {
  refundAuthAttempt,
  reserveAuthAttempt,
} from "../utils/authFailureThrottle";
import { parseScopes } from "../utils/protectedResource";

const BEARER_PREFIX = /^Bearer\s+/i;

type ApiTokenAuthResult = {
  userId: string;
  // NULL preserved from the column: "full access" (see requireScope in
  // server/utils/auth.ts), not "no scopes".
  scopes: string[] | null;
  // NULL means "never expires". Carried into context so a mint request
  // (server/api/tokens/index.post.ts) can bound a newly minted token's
  // lifetime to its own — otherwise a short-lived leaked token could mint
  // itself a longer-lived (or permanent) replacement and outlive its own
  // expiry, the same escalation the scopes subset check closes for scope.
  expiresAt: Date | null;
};

async function authenticateViaApiToken(
  rawToken: string,
): Promise<ApiTokenAuthResult | null> {
  const incomingHash = hashToken(rawToken);

  const [matched] = await getDb()
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
      scopes: apiTokens.scopes,
    })
    .from(apiTokens)
    .where(
      and(eq(apiTokens.hashedToken, incomingHash), isNull(apiTokens.revokedAt)),
    )
    .limit(1);

  if (!matched) {
    return null;
  }

  if (isTokenExpired(matched.expiresAt)) {
    return null;
  }

  await refreshTokenLastUsedAt(matched.id, matched.lastUsedAt);

  return {
    userId: matched.userId,
    scopes: parseScopes(matched.scopes),
    expiresAt: matched.expiresAt,
  };
}

async function authenticateViaClerk(token: string): Promise<string | null> {
  try {
    const clerkClient = getClerkClient();
    const { sub } = await clerkClient.verifyToken(token);
    return sub;
  } catch {
    return null;
  }
}

// Exported so tests/server/api/scopeCoverage.test.ts can verify its list of
// scope-exempt public handlers against this same bypass list instead of
// hand-duplicating it — the two are the same security-relevant decision and
// must not drift apart.
export const HOOKS_PATH_PREFIX = "/api/hooks/";
export const BILLING_WEBHOOK_PATH = "/api/billing/webhook";
// Clerk signs this webhook with a Svix signature (verified in the handler), not
// a bearer token, so it must bypass the token/session auth below.
export const CLERK_WEBHOOK_PATH = "/api/webhooks/clerk";
const RETRY_AFTER_HEADER = "Retry-After";

// Throttles every authenticated /api/* request (see apiThrottle.ts for why
// this is keyed by userId and not by token/session). Mirrors
// enforceThrottle in server/api/hooks/[slug].post.ts: record the hit, and on
// denial set Retry-After before throwing the 429 envelope.
async function enforceApiThrottle(
  event: H3Event,
  userId: string,
): Promise<void> {
  const throttleResult = await recordAuthedApiHit(userId);

  if (throttleResult.allowed) {
    return;
  }

  setHeader(
    event,
    RETRY_AFTER_HEADER,
    String(throttleResult.retryAfterSeconds),
  );
  apiErrorHandler(
    tooManyRequestsError(
      "You have made too many requests. Slow down and try again shortly.",
    ),
  );
}

// Netlify's edge sets this to the real client IP on every function invocation
// (https://docs.netlify.com/functions/api/#netlify-specific-context-object /
// request headers). Unlike X-Forwarded-For, a client cannot set or append to
// this header themselves — Netlify's edge overwrites it — so it is the only
// IP source here that is safe to key a rate limit on. getRequestIP's own
// `xForwardedFor` option would trust the client-suppliable X-Forwarded-For
// header instead, which a script can set to a fresh value on every request
// to mint itself a fresh throttle bucket each time, defeating the limiter
// entirely.
const NETLIFY_CLIENT_IP_HEADER = "x-nf-client-connection-ip";

// Falls back to h3's own socket-derived getRequestIP (no xForwardedFor trust)
// for non-Netlify environments (local dev, tests) where the Netlify header is
// absent. That fallback can be inaccurate behind an unknown proxy (it may
// resolve to the proxy's own address, coalescing many real clients into one
// bucket), which is an acceptable degradation for a limiter that already
// fails open on every other kind of infrastructure gap.
//
// The header is trusted unconditionally rather than gated behind an
// env-var check for "are we actually running on Netlify" — there isn't a
// reliable one to gate on: `process.env.NETLIFY` is a Netlify *build-time*
// value and is not present in the deployed Function's runtime environment,
// so a runtime check against it would always evaluate false and silently
// disable the trusted header for every real request, not just non-Netlify
// ones. This app deploys exclusively behind Netlify's edge (see envs/ and
// the dotenvx .env.production setup), which is what actually makes trusting
// this header safe; a future host migration would need to revisit this.
function resolveClientIp(event: H3Event): string | undefined {
  return getHeader(event, NETLIFY_CLIENT_IP_HEADER) ?? getRequestIP(event);
}

function throwAuthFailureThrottled(
  event: H3Event,
  retryAfterSeconds: number,
): never {
  setHeader(event, RETRY_AFTER_HEADER, String(retryAfterSeconds));
  apiErrorHandler(
    tooManyRequestsError(
      "Too many failed authentication attempts from this IP address. Slow down and try again shortly.",
    ),
  );
}

// Atomically reserves one unit of the IP's failed-auth budget *before*
// verification runs, and throws the throttle's 429 immediately if that
// reservation itself came back over budget. This has to happen before
// verification, not after a failure, to actually stop a guessing loop:
// Netlify runs requests concurrently, so a read-then-write pre-check (check,
// then only record on failure) would let an entire burst of simultaneous
// guesses past the check before any of them had recorded a failure — see the
// comment on reserveAuthAttempt in authFailureThrottle.ts. Reserving instead
// spends budget the moment an attempt is made, correct or not; a correct one
// gets it back via refundAuthAttempt below.
async function reserveAuthBudgetOrThrow(
  event: H3Event,
  clientIp: string,
): Promise<void> {
  const throttleResult = await reserveAuthAttempt(clientIp);
  if (throttleResult.allowed) {
    return;
  }

  throwAuthFailureThrottled(event, throttleResult.retryAfterSeconds);
}

// True for every request this middleware does not gate: non-API routes, and
// the three webhook paths verified by their own signature instead of a
// bearer token/session (see the constants' own comments above).
function isPublicPath(path: string): boolean {
  return (
    !path.startsWith("/api/") ||
    path.startsWith(HOOKS_PATH_PREFIX) ||
    path === BILLING_WEBHOOK_PATH ||
    path === CLERK_WEBHOOK_PATH
  );
}

type CredentialAuthResult = {
  apiTokenAuth: ApiTokenAuthResult | null;
  userId: string | undefined;
};

// Resolves whichever credential the request presented (mp_live_ API token vs
// Clerk session token) into a userId. Takes viaApiToken rather than
// recomputing isApiToken(rawToken) itself, since the caller already needs
// that value to decide whether to throttle (see the handler below) — split
// out so the branching between the two credential kinds, and their
// different auth result shapes, reads as one self-contained step rather than
// adding to the handler's own branch count.
async function resolveCredentialAuth(
  rawToken: string,
  viaApiToken: boolean,
): Promise<CredentialAuthResult> {
  const apiTokenAuth = viaApiToken
    ? await authenticateViaApiToken(rawToken)
    : null;
  const userId = viaApiToken
    ? apiTokenAuth?.userId
    : await authenticateViaClerk(rawToken);

  return { apiTokenAuth, userId };
}

// Only the Clerk path can carry a brand-new identity; an API token can only
// exist for an already-registered user. Registration runs outside
// authenticateViaClerk's own try/catch so a disabled-signups 403 is not
// swallowed into a 401, and ahead of enforceApiThrottle so a signup rejection
// never spends the new user's own throttle budget on its way out.
async function finalizeAuthenticatedRequest(
  event: H3Event,
  viaApiToken: boolean,
  {
    apiTokenAuth,
    userId,
  }: CredentialAuthResult & {
    userId: string;
  },
): Promise<void> {
  if (!viaApiToken) {
    await ensureUserRegistered(userId);
  }

  await enforceApiThrottle(event, userId);

  event.context.userId = userId;
  // A Clerk session is always full access (scoping only restricts API
  // tokens); an API token's scopes came back from authenticateViaApiToken,
  // where NULL already means full access (see requireScope).
  event.context.tokenScopes = viaApiToken
    ? (apiTokenAuth?.scopes ?? null)
    : null;
  // A Clerk session has no token lifetime to inherit (null = unconstrained);
  // an API token's own expiresAt bounds what it can mint (see
  // clampToCallerExpiry in server/api/tokens/index.post.ts).
  event.context.tokenExpiresAt = viaApiToken
    ? (apiTokenAuth?.expiresAt ?? null)
    : null;
}

export default defineEventHandler(async (event) => {
  if (isPublicPath(event.path)) {
    return;
  }

  const rawToken = getHeader(event, "authorization")?.replace(
    BEARER_PREFIX,
    "",
  );
  if (!rawToken) {
    throwUnauthorized();
  }

  // Only the mp_live_ API token path is throttled by IP: it is the only
  // credential kind an external script can brute-force guess. A Clerk
  // session is a Clerk-signed JWT — nothing short of Clerk's own signing key
  // can forge one, so an expired/garbage value failing verification is never
  // a guess worth budgeting, and counting it would risk throttling every
  // user behind a shared IP (an office NAT, a carrier-grade NAT) over
  // ordinary logged-out/expired-session traffic rather than an actual attack.
  const viaApiToken = isApiToken(rawToken);
  const clientIp = viaApiToken ? resolveClientIp(event) : undefined;
  if (clientIp) {
    await reserveAuthBudgetOrThrow(event, clientIp);
  }

  const credentialAuth = await resolveCredentialAuth(rawToken, viaApiToken);
  if (!credentialAuth.userId) {
    throwUnauthorized();
  }

  if (clientIp) {
    await refundAuthAttempt(clientIp);
  }

  await finalizeAuthenticatedRequest(event, viaApiToken, {
    ...credentialAuth,
    userId: credentialAuth.userId,
  });
});
