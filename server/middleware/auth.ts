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

export default defineEventHandler(async (event) => {
  if (!event.path.startsWith("/api/")) {
    return;
  }

  if (event.path.startsWith(HOOKS_PATH_PREFIX)) {
    return;
  }

  if (event.path === BILLING_WEBHOOK_PATH) {
    return;
  }

  if (event.path === CLERK_WEBHOOK_PATH) {
    return;
  }

  const rawToken = getHeader(event, "authorization")?.replace(
    BEARER_PREFIX,
    "",
  );
  if (!rawToken) {
    throwUnauthorized();
  }

  const viaApiToken = isApiToken(rawToken);
  const apiTokenAuth = viaApiToken
    ? await authenticateViaApiToken(rawToken)
    : null;
  const userId = viaApiToken
    ? apiTokenAuth?.userId
    : await authenticateViaClerk(rawToken);

  if (!userId) {
    throwUnauthorized();
  }

  // Only the Clerk path can carry a brand-new identity; an API token can only
  // exist for an already-registered user. Runs outside authenticateViaClerk's
  // try/catch so a disabled-signups 403 is not swallowed into a 401.
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
});
