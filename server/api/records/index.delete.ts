import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { records } from "../../db/schema";
import { requireUser } from "../../utils/auth";
import { ApiError, apiErrorHandler } from "../../utils/errors";
import { apiValidate } from "../../utils/validate";
import { isValidUuid } from "../../utils/uuid";
import type { ApiRequest } from "../../types/api.types";
import { writeEvent } from "../../utils/eventWriter";
import { MAX_DELETE_BATCH_SIZE } from "#shared/utils/records";

type DeleteRecordsBody = ApiRequest & {
  data: {
    attributes: {
      uuids?: unknown;
    };
  };
};

type DeleteRecordsResponse = {
  meta: { deleted: number };
};

function uuidsError(detail: string): ApiError {
  return new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail,
        source: { pointer: "/data/attributes/uuids" },
      },
    ],
    422,
  );
}

function validateUuids(body: DeleteRecordsBody): string[] {
  apiValidate(body, [
    {
      key: "uuids",
      message: "Uuids is required and must be a non-empty array",
    },
  ]);

  const uuids = body.data?.attributes?.uuids;

  if (!Array.isArray(uuids) || uuids.length === 0) {
    throw uuidsError("Uuids is required and must be a non-empty array");
  }

  if (uuids.length > MAX_DELETE_BATCH_SIZE) {
    throw uuidsError(
      `Uuids must not contain more than ${MAX_DELETE_BATCH_SIZE} items`,
    );
  }

  if (!uuids.every((uuid) => typeof uuid === "string")) {
    throw uuidsError("All uuids must be strings");
  }

  if (!uuids.every((uuid) => isValidUuid(uuid))) {
    throw uuidsError("All uuids must be valid UUIDs");
  }

  return uuids as string[];
}

async function deleteUserRecords(
  userId: string,
  uuids: string[],
): Promise<number> {
  const db = getDb();

  const deleted = await db
    .delete(records)
    .where(and(eq(records.userId, userId), inArray(records.uuid, uuids)))
    .returning({ uuid: records.uuid });

  return deleted.length;
}

export default defineEventHandler(
  async (event): Promise<DeleteRecordsResponse> => {
    try {
      const userId = requireUser(event);
      const body = (await readBody(event)) as DeleteRecordsBody;

      const uuids = validateUuids(body);
      const deletedCount = await deleteUserRecords(userId, uuids);

      if (deletedCount > 0) {
        await writeEvent({
          userId,
          kind: "dim",
          message: `Deleted ${deletedCount} record${deletedCount === 1 ? "" : "s"}`,
        }).catch((writeError) => {
          console.error("[records/delete] failed to write event:", writeError);
        });
      }

      return { meta: { deleted: deletedCount } };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
