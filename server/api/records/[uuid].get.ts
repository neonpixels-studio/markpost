import { and, eq, getTableColumns } from "drizzle-orm";
import { getDb } from "../../db";
import { records, sources } from "../../db/schema";
import { requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";
import { recordSerializer, type RecordApiResponse } from "../../utils/response";
import { isValidUuid } from "../../utils/uuid";
import {
  invalidUuidError,
  recordNotFoundError,
} from "../../utils/recordErrors";

export async function findRecordForUser(
  db: ReturnType<typeof getDb>,
  uuid: string,
  userId: string,
) {
  const rows = await db
    .select({ ...getTableColumns(records), sourceType: sources.type })
    .from(records)
    // Scope the join to the same user so it can never surface another tenant's
    // source type, even if a future write path sets sourceId without the
    // ownership check that guards it today.
    .leftJoin(
      sources,
      and(eq(records.sourceId, sources.uuid), eq(sources.userId, userId)),
    )
    .where(and(eq(records.uuid, uuid), eq(records.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
}

export default defineEventHandler(async (event): Promise<RecordApiResponse> => {
  const userId = requireUser(event);
  try {
    const uuid = getRouterParam(event, "uuid");

    if (!isValidUuid(uuid)) {
      throw invalidUuidError();
    }

    const record = await findRecordForUser(getDb(), uuid, userId);

    if (!record) {
      throw recordNotFoundError();
    }

    return { data: recordSerializer(record) };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
