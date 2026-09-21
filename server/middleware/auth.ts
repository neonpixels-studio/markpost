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
  isAuthFailureThrottled,
  recordAuthFailure,
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

// Read-only pre-check, run before spending any work verifying a presented
// token/session. Without this, an IP that already exhausted its budget would
// still get a full verification pass on every subsequent request — a correct
// guess would still authenticate, and only a wrong one would trade its 401
// for a 429 — which does not actually stop a guessing loop, only relabel its
// failures. Keyed by IP rather than by userId (enforceApiThrottle's key)
// because nothing is authenticated yet at this point in the request.
async function rejectIfAuthFailureThrottled(
  event: H3Event,
  clientIp: string,
): Promise<void> {
  const throttleResult = await isAuthFailureThrottled(clientIp);
  if (throttleResult.allowed) {
    return;
  }

  throwAuthFailureThrottled(event, throttleResult.retryAfterSeconds);
}

// Spends failure-throttle budget once verification has actually failed, then
// throws the appropriate rejection: 429 if this failure is the one that tips
// the IP over budget (so the caller gets immediate feedback rather than
// waiting for its next request to hit the pre-check above), otherwise the
// normal 401. Never called for a missing Authorization header — omitting the
// header entirely is not a guess at a token value, and counting it here would
// let a handful of logged-out/expired-session requests from a shared IP
// (an office NAT, a carrier-grade NAT) exhaust the same budget a real
// guessing loop would need to trip.
async function recordAuthFailureAndThrow(
  event: H3Event,
  clientIp: string,
): Promise<never> {
  const throttleResult = await recordAuthFailure(clientIp);
  if (!throttleResult.allowed) {
    throwAuthFailureThrottled(event, throttleResult.retryAfterSeconds);
  }

  throwUnauthorized();
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
  viaApiToken: boolean;
  apiTokenAuth: ApiTokenAuthResult | null;
  userId: string | undefined;
};

// Resolves whichever credential the request presented (mp_live_ API token vs
// Clerk session token) into a userId. Split out of the handler so the
// branching between the two credential kinds — and their different auth
// result shapes — reads as one self-contained step rather than adding to the
// handler's own branch count.
async function resolveCredentialAuth(
  rawToken: string,
): Promise<CredentialAuthResult> {
  const viaApiToken = isApiToken(rawToken);
  const apiTokenAuth = viaApiToken
    ? await authenticateViaApiToken(rawToken)
    : null;
  const userId = viaApiToken
    ? apiTokenAuth?.userId
    : await authenticateViaClerk(rawToken);

  return { viaApiToken, apiTokenAuth, userId };
}

// Throws (never returns) when authentication failed: spends failed-auth
// throttle budget by IP when one was resolved, then always ends in either
// the throttle's own 429 or the standard 401.
async function rejectUnauthenticated(
  event: H3Event,
  clientIp: string | undefined,
): Promise<never> {
  if (clientIp) {
    await recordAuthFailureAndThrow(event, clientIp);
  }
  throwUnauthorized();
}

// Only the Clerk path can carry a brand-new identity; an API token can only
// exist for an already-registered user. Registration runs outside
// authenticateViaClerk's own try/catch so a disabled-signups 403 is not
// swallowed into a 401, and ahead of enforceApiThrottle so a signup rejection
// never spends the new user's own throttle budget on its way out.
async function finalizeAuthenticatedRequest(
  event: H3Event,
  {
    viaApiToken,
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

  const clientIp = resolveClientIp(event);
  if (clientIp) {
    await rejectIfAuthFailureThrottled(event, clientIp);
  }

  const credentialAuth = await resolveCredentialAuth(rawToken);
  if (!credentialAuth.userId) {
    await rejectUnauthenticated(event, clientIp);
  }

  await finalizeAuthenticatedRequest(event, {
    ...credentialAuth,
    userId: credentialAuth.userId,
  });
});
