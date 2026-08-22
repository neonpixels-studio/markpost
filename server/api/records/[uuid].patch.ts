import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { records, RECORD_STATUSES, type RecordStatus } from "../../db/schema";
import type { ApiRequest } from "../../types/api.types";
import { requireUser } from "../../utils/auth";
import { ApiError, apiErrorHandler } from "../../utils/errors";
import { recordSerializer, type RecordApiResponse } from "../../utils/response";
import { isValidUuid } from "../../utils/uuid";
import { isFilePathUniqueViolation } from "../../utils/filePathCollision";
import {
  invalidUuidError,
  recordNotFoundError,
  filePathConflictError,
} from "../../utils/recordErrors";

type PatchRecordAttributes = {
  status?: string;
  syncedAt?: unknown;
  filePath?: string | null;
  errorMessage?: string | null;
};

type PatchRecordBody = ApiRequest & {
  data: {
    attributes: PatchRecordAttributes;
  };
};

type RecordUpdatePayload = {
  status?: string;
  syncedAt?: Date | null;
  filePath?: string | null;
  errorMessage?: string | null;
};

// Shared shape for every 422 "Invalid Attribute" case below; only the
// detail message and the offending pointer differ per field.
function invalidAttributeError(detail: string, pointer: string): ApiError {
  return new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail,
        source: { pointer },
      },
    ],
    422,
  );
}

function attributesShapeError(): ApiError {
  return invalidAttributeError(
    "Attributes must be an object.",
    "/data/attributes",
  );
}

function emptyUpdateError(): ApiError {
  return invalidAttributeError(
    "At least one of status, syncedAt, filePath, or errorMessage must be provided.",
    "/data/attributes",
  );
}

function statusInvalidError(): ApiError {
  return invalidAttributeError(
    `Status must be one of: ${RECORD_STATUSES.join(", ")}`,
    "/data/attributes/status",
  );
}

function syncedAtTypeError(): ApiError {
  return invalidAttributeError(
    "SyncedAt must be a date string or null",
    "/data/attributes/syncedAt",
  );
}

function syncedAtInvalidError(): ApiError {
  return invalidAttributeError(
    "SyncedAt must be a valid date string",
    "/data/attributes/syncedAt",
  );
}

function filePathTypeError(): ApiError {
  return invalidAttributeError(
    "FilePath must be a string or null",
    "/data/attributes/filePath",
  );
}

function errorMessageTypeError(): ApiError {
  return invalidAttributeError(
    "ErrorMessage must be a string or null",
    "/data/attributes/errorMessage",
  );
}

// readBody returns whatever JSON the client sent; the PatchRecordBody cast
// above is compile-time only, so a client sending a non-object attributes
// value (e.g. a string or array) must be rejected here rather than letting
// the `"key" in attributes` checks below throw a raw TypeError.
function isPlainAttributesObject(
  value: unknown,
): value is PatchRecordAttributes {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordStatus(value: unknown): value is RecordStatus {
  return (
    typeof value === "string" &&
    (RECORD_STATUSES as readonly string[]).includes(value)
  );
}

function validateStatus(attributes: PatchRecordAttributes): void {
  if (attributes.status === undefined) {
    return;
  }

  if (!isRecordStatus(attributes.status)) {
    throw statusInvalidError();
  }
}

function validateSyncedAtType(raw: unknown): void {
  if (raw === null || typeof raw === "string") {
    return;
  }

  throw syncedAtTypeError();
}

function validateNullableStringField(
  value: unknown,
  onInvalid: () => ApiError,
): void {
  if (value === null || typeof value === "string") {
    return;
  }

  throw onInvalid();
}

// Runs the per-field type checks up front. buildUpdatePayload still parses
// syncedAt into a Date and can throw syncedAtInvalidError there, since that
// check needs the parsed value rather than just the raw type.
function validateAttributes(attributes: PatchRecordAttributes): void {
  validateStatus(attributes);

  if ("syncedAt" in attributes) {
    validateSyncedAtType(attributes.syncedAt);
  }

  if ("filePath" in attributes) {
    validateNullableStringField(attributes.filePath, filePathTypeError);
  }

  if ("errorMessage" in attributes) {
    validateNullableStringField(attributes.errorMessage, errorMessageTypeError);
  }
}

function parseSyncedAt(raw: unknown): Date | null {
  if (raw === null) {
    return null;
  }

  const parsed = new Date(raw as string);

  if (Number.isNaN(parsed.getTime())) {
    throw syncedAtInvalidError();
  }

  return parsed;
}

function buildUpdatePayload(
  attributes: PatchRecordAttributes,
): RecordUpdatePayload {
  const payload: RecordUpdatePayload = {};

  if (attributes.status !== undefined) {
    payload.status = attributes.status;
  }

  if ("syncedAt" in attributes) {
    payload.syncedAt = parseSyncedAt(attributes.syncedAt);
  }

  if ("filePath" in attributes) {
    payload.filePath = attributes.filePath ?? null;
  }

  if ("errorMessage" in attributes) {
    payload.errorMessage = attributes.errorMessage ?? null;
  }

  return payload;
}

async function updateUserRecord(
  userId: string,
  recordUuid: string,
  payload: RecordUpdatePayload,
) {
  const db = getDb();

  try {
    const [updated] = await db
      .update(records)
      .set(payload)
      .where(and(eq(records.userId, userId), eq(records.uuid, recordUuid)))
      .returning();

    return updated ?? null;
  } catch (error) {
    if (isFilePathUniqueViolation(error)) {
      throw filePathConflictError();
    }

    throw error;
  }
}

export default defineEventHandler(async (event): Promise<RecordApiResponse> => {
  try {
    const userId = requireUser(event);
    const recordUuid = getRouterParam(event, "uuid");

    if (!isValidUuid(recordUuid)) {
      throw invalidUuidError();
    }

    const body = (await readBody(event)) as PatchRecordBody;
    const attributes = body?.data?.attributes ?? {};

    if (!isPlainAttributesObject(attributes)) {
      throw attributesShapeError();
    }

    validateAttributes(attributes);

    const payload = buildUpdatePayload(attributes);

    if (Object.keys(payload).length === 0) {
      throw emptyUpdateError();
    }

    const updated = await updateUserRecord(userId, recordUuid, payload);

    if (!updated) {
      throw recordNotFoundError();
    }

    return { data: recordSerializer(updated) };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
