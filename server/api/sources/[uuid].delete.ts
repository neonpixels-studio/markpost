import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { sources } from "../../db/schema";
import { requireScope, requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";
import { sourceNotFoundError } from "../../utils/sourceErrors";
import { invalidUuidError, isValidUuid } from "../../utils/uuid";

type DeleteSourceResponse = {
  meta: { deleted: number };
};

async function deleteUserSource(
  userId: string,
  sourceUuid: string,
): Promise<number> {
  const db = getDb();

  const deleted = await db
    .delete(sources)
    .where(and(eq(sources.userId, userId), eq(sources.uuid, sourceUuid)))
    .returning({ uuid: sources.uuid });

  return deleted.length;
}

export default defineEventHandler(
  async (event): Promise<DeleteSourceResponse> => {
    try {
      const userId = requireUser(event);
      requireScope(event, "sources:write");
      const sourceUuid = getRouterParam(event, "uuid");

      if (!isValidUuid(sourceUuid)) {
        throw invalidUuidError();
      }

      const deletedCount = await deleteUserSource(userId, sourceUuid);

      if (deletedCount === 0) {
        throw sourceNotFoundError();
      }

      return { meta: { deleted: deletedCount } };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
