import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { userSettings } from "../../db/schema";
import { requireScope, requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";
import {
  userSettingsSerializer,
  type UserSettingsApiResponse,
} from "../../utils/response";

type Database = ReturnType<typeof getDb>;

async function findUserSettings(database: Database, userId: string) {
  const [row] = await database
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  return row ?? null;
}

async function createDefaultSettings(database: Database, userId: string) {
  const [created] = await database
    .insert(userSettings)
    .values({ userId })
    .onConflictDoNothing()
    .returning();

  if (created) {
    return created;
  }

  return findUserSettings(database, userId);
}

async function getOrCreateSettings(database: Database, userId: string) {
  const existing = await findUserSettings(database, userId);
  if (existing) {
    return existing;
  }

  return createDefaultSettings(database, userId);
}

export default defineEventHandler(
  async (event): Promise<UserSettingsApiResponse> => {
    try {
      const userId = requireUser(event);
      requireScope(event, "settings:read");
      const database = getDb();
      const settings = await getOrCreateSettings(database, userId);

      return { data: userSettingsSerializer(settings) };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);

export { findUserSettings, createDefaultSettings };
