import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { sources } from "../../db/schema";
import type { ApiRequest } from "../../types/api.types";
import { requireUser } from "../../utils/auth";
import { ApiError, apiErrorHandler } from "../../utils/errors";
import { sourceSerializer, type SourceApiResponse } from "../../utils/response";
import { assertValidFieldMapping } from "../../utils/fieldMappingValidation";
import { assertValidRouteFolder } from "../../utils/routeFolder";
import { sourceNotFoundError } from "../../utils/sourceErrors";
import { invalidUuidError, isValidUuid } from "../../utils/uuid";

type PatchSourceAttributes = {
  routeFolder?: string;
  fieldMapping?: unknown;
};

type PatchSourceBody = ApiRequest & {
  data: {
    attributes: PatchSourceAttributes;
  };
};

type SourceUpdatePayload = {
  routeFolder?: string;
  fieldMapping?: unknown;
};

function emptyUpdateError(): ApiError {
  return new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail: "At least one of routeFolder or fieldMapping must be provided.",
        source: { pointer: "/data/attributes" },
      },
    ],
    422,
  );
}

function buildUpdatePayload(
  attributes: PatchSourceAttributes,
): SourceUpdatePayload {
  const payload: SourceUpdatePayload = {};

  if (attributes.routeFolder !== undefined) {
    payload.routeFolder = attributes.routeFolder;
  }

  if ("fieldMapping" in attributes) {
    payload.fieldMapping = attributes.fieldMapping ?? null;
  }

  return payload;
}

async function updateUserSource(
  userId: string,
  sourceUuid: string,
  payload: SourceUpdatePayload,
) {
  const db = getDb();

  const [updated] = await db
    .update(sources)
    .set(payload)
    .where(and(eq(sources.userId, userId), eq(sources.uuid, sourceUuid)))
    .returning();

  return updated ?? null;
}

export default defineEventHandler(async (event): Promise<SourceApiResponse> => {
  try {
    const userId = requireUser(event);
    const sourceUuid = getRouterParam(event, "uuid");

    if (!isValidUuid(sourceUuid)) {
      throw invalidUuidError();
    }

    const body = (await readBody(event)) as PatchSourceBody;
    const attributes = body?.data?.attributes ?? {};

    if (attributes.routeFolder !== undefined) {
      attributes.routeFolder = assertValidRouteFolder(attributes.routeFolder);
    }

    if (attributes.fieldMapping !== undefined) {
      attributes.fieldMapping = assertValidFieldMapping(
        attributes.fieldMapping,
      );
    }

    const payload = buildUpdatePayload(attributes);

    if (Object.keys(payload).length === 0) {
      throw emptyUpdateError();
    }

    const updated = await updateUserSource(userId, sourceUuid, payload);

    if (!updated) {
      throw sourceNotFoundError();
    }

    return { data: sourceSerializer(updated) };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
