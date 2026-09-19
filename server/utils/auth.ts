import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { throwForbiddenScope, throwUnauthorized } from "./errors";
import type { ScopeName } from "./protectedResource";

export function requireUser(event: H3Event): string {
  const userId = event.context.userId as string | undefined;
  if (!userId) {
    throwUnauthorized();
  }
  return userId;
}

// Gates a handler on a scope. `event.context.tokenScopes` is populated by
// server/middleware/auth.ts: NULL/undefined means full access — either a
// Clerk browser session (always full access; scoping only applies to API
// tokens) or an API token minted without a `scopes` list, which is the
// documented backward-compatible default for both new omit-scopes mints and
// every token minted before this column existed. A non-null array is an
// exact allowlist: the requested scope must be a member or the request is
// rejected with a 403 naming the missing scope.
export function requireScope(event: H3Event, scope: ScopeName): void {
  const tokenScopes = event.context.tokenScopes as
    ScopeName[] | null | undefined;

  if (tokenScopes == null) {
    return;
  }

  if (!tokenScopes.includes(scope)) {
    throwForbiddenScope(scope);
  }
}

export function signupsDisabled(): boolean {
  // Read via runtimeConfig (not process.env) so the value baked in at build time
  // survives into the deployed Netlify function.
  return useRuntimeConfig().disableSignups === "true";
}

export async function ensureUserRegistered(userId: string): Promise<void> {
  const database = getDb();

  const [existing] = await database
    .select({ userId: users.userId })
    .from(users)
    .where(eq(users.userId, userId))
    .limit(1);

  if (existing) {
    return;
  }

  if (signupsDisabled()) {
    throw createError({
      statusCode: 403,
      statusMessage: "Sign-ups are currently disabled",
    });
  }

  await database.insert(users).values({ userId }).onConflictDoNothing();
}
