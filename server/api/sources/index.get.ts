import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { sources } from "../../db/schema";
import { requireScope, requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";
import {
  sourceSerializer,
  type SourceListApiResponse,
} from "../../utils/response";

async function listUserSources(userId: string) {
  const db = getDb();
  return db.select().from(sources).where(eq(sources.userId, userId));
}

export default defineEventHandler(
  async (event): Promise<SourceListApiResponse> => {
    try {
      const userId = requireUser(event);
      requireScope(event, "sources:read");
      const rows = await listUserSources(userId);
      const data = rows
        .map((source) => sourceSerializer(source))
        .filter((resource) => resource !== null);

      return { data };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
