import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { apiTokens } from "../db/schema";
import { hashToken, isApiToken, isTokenExpired } from "../utils/tokens";
import { refreshTokenLastUsedAt } from "../utils/tokenUsage";
import { ensureUserRegistered } from "../utils/auth";
import { getClerkClient } from "../utils/clerk";
import { throwUnauthorized } from "../utils/errors";

const BEARER_PREFIX = /^Bearer\s+/i;

async function authenticateViaApiToken(
  rawToken: string,
): Promise<string | null> {
  const incomingHash = hashToken(rawToken);

  const [matched] = await getDb()
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
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

  return matched.userId;
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

const HOOKS_PATH_PREFIX = "/api/hooks/";
const BILLING_WEBHOOK_PATH = "/api/billing/webhook";
// Clerk signs this webhook with a Svix signature (verified in the handler), not
// a bearer token, so it must bypass the token/session auth below.
const CLERK_WEBHOOK_PATH = "/api/webhooks/clerk";

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
  const userId = viaApiToken
    ? await authenticateViaApiToken(rawToken)
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

  event.context.userId = userId;
});
