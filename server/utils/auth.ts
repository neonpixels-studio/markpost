import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { throwUnauthorized } from "./errors";

export function requireUser(event: H3Event): string {
  const userId = event.context.userId as string | undefined;
  if (!userId) {
    throwUnauthorized();
  }
  return userId;
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
