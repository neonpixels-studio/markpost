import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { sources } from "../../db/schema";
import { requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";
import { sourceSerializer, type SourceApiResponse } from "../../utils/response";
import { sourceNotFoundError } from "../../utils/sourceErrors";
import { invalidUuidError, isValidUuid } from "../../utils/uuid";

async function findUserSource(userId: string, sourceUuid: string) {
  const db = getDb();

  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.uuid, sourceUuid)))
    .limit(1);

  return rows[0] ?? null;
}

export default defineEventHandler(async (event): Promise<SourceApiResponse> => {
  try {
    const userId = requireUser(event);
    const sourceUuid = getRouterParam(event, "uuid");

    if (!isValidUuid(sourceUuid)) {
      throw invalidUuidError();
    }

    const source = await findUserSource(userId, sourceUuid);

    if (!source) {
      throw sourceNotFoundError();
    }

    return { data: sourceSerializer(source) };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
