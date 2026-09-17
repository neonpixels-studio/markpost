import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { apiTokens } from "../../db/schema";
import { requireScope, requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";
import type { ScopeName } from "../../utils/protectedResource";
import type { ApiResponse } from "../../types/api.types";

type TokenListItem = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  scopes: string[] | null;
};

type TokenResource = {
  type: "api_tokens";
  id: string;
  attributes: {
    name: string;
    prefix: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    // NULL means full access — see server/db/schema.ts apiTokens.scopes.
    scopes: ScopeName[] | null;
  };
};

type TokenListApiResponse = ApiResponse<TokenResource[]>;

function tokenSerializer(token: TokenListItem): TokenResource {
  return {
    type: "api_tokens",
    id: token.id,
    attributes: {
      name: token.name,
      prefix: token.prefix,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      expiresAt: token.expiresAt,
      // Cast is safe: every persisted value was validated against
      // SCOPE_NAMES at mint time (server/api/tokens/index.post.ts).
      scopes: token.scopes as ScopeName[] | null,
    },
  };
}

// Lists every non-revoked token, including ones past their expiresAt: an
// expired-but-unrevoked token can no longer authenticate (server/middleware/
// auth.ts), but still needs to show up here so the owner can see it expired
// and clean it up. The UI surfaces the distinction (SetTokens.vue).
async function listUnrevokedTokens(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<TokenListItem[]> {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
      scopes: apiTokens.scopes,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(apiTokens.createdAt);
}

export default defineEventHandler(
  async (event): Promise<TokenListApiResponse> => {
    try {
      const userId = requireUser(event);
      requireScope(event, "tokens:read");
      const tokens = await listUnrevokedTokens(getDb(), userId);

      return { data: tokens.map(tokenSerializer) };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
