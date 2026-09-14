import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { records } from "../../db/schema";
import type { ApiRequest } from "../../types/api.types";
import { requireUser } from "../../utils/auth";
import { ApiError, apiErrorHandler } from "../../utils/errors";
import { recordSerializer, type RecordApiResponse } from "../../utils/response";
import { isValidUuid } from "../../utils/uuid";
import { isFilePathUniqueViolation } from "../../utils/filePathCollision";
import { writeEvent } from "../../utils/eventWriter";
import { isRecordStatus } from "#shared/utils/records";
import {
  invalidUuidError,
  recordNotFoundError,
  filePathConflictError,
  invalidAttributeError,
  attributesShapeError,
  statusInvalidError,
  syncedAtTypeError,
  syncedAtInvalidError,
  filePathTypeError,
  errorMessageTypeError,
} from "../../utils/recordErrors";
import { resolveSourceTypes, withSourceType } from "../../utils/sourceType";

const STATUS_POINTER = "/data/attributes/status";
const SYNCED_AT_POINTER = "/data/attributes/syncedAt";
const FILE_PATH_POINTER = "/data/attributes/filePath";
const ERROR_MESSAGE_POINTER = "/data/attributes/errorMessage";
const TITLE_POINTER = "/data/attributes/title";
const CONTENT_POINTER = "/data/attributes/content";

type PatchRecordAttributes = {
  status?: string;
  syncedAt?: unknown;
  filePath?: string | null;
  errorMessage?: string | null;
  title?: string;
  content?: string;
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
  title?: string;
  content?: string;
};

const ATTRIBUTES_POINTER = "/data/attributes";

function emptyUpdateError(): ApiError {
  return invalidAttributeError(
    "At least one of status, syncedAt, filePath, errorMessage, title, or content must be provided.",
    ATTRIBUTES_POINTER,
  );
}

function titleInvalidError(): ApiError {
  return invalidAttributeError(
    "Title must be a non-empty string",
    TITLE_POINTER,
  );
}

function contentTypeError(): ApiError {
  return invalidAttributeError("Content must be a string", CONTENT_POINTER);
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

function validateStatus(attributes: PatchRecordAttributes): void {
  if (attributes.status === undefined) {
    return;
  }

  if (!isRecordStatus(attributes.status)) {
    throw statusInvalidError(STATUS_POINTER);
  }
}

function validateSyncedAtType(raw: unknown): void {
  if (raw === null || typeof raw === "string") {
    return;
  }

  throw syncedAtTypeError(SYNCED_AT_POINTER);
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

// title and content are NOT NULL columns (server/db/schema.ts) — unlike
// filePath/errorMessage, null is never a legal value here, so this rejects
// anything that isn't a string outright rather than allowing a nullable
// escape hatch.
function validateRequiredStringField(
  value: unknown,
  onInvalid: () => ApiError,
): void {
  if (typeof value === "string") {
    return;
  }

  throw onInvalid();
}

// A blank title would leave the record un-labelled everywhere it's rendered
// (inbox rows, the detail modal's heading, trigram search) — trimmed to
// catch whitespace-only titles too. Content has no such downstream reader
// that breaks on empty, so it only gets the type check above.
function validateTitle(attributes: PatchRecordAttributes): void {
  if (attributes.title === undefined) {
    return;
  }

  validateRequiredStringField(attributes.title, titleInvalidError);

  if (attributes.title.trim().length === 0) {
    throw titleInvalidError();
  }
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
    validateNullableStringField(attributes.filePath, () =>
      filePathTypeError(FILE_PATH_POINTER),
    );
  }

  if ("errorMessage" in attributes) {
    validateNullableStringField(attributes.errorMessage, () =>
      errorMessageTypeError(ERROR_MESSAGE_POINTER),
    );
  }

  validateTitle(attributes);

  if ("content" in attributes) {
    validateRequiredStringField(attributes.content, contentTypeError);
  }
}

function parseSyncedAt(raw: unknown): Date | null {
  if (raw === null) {
    return null;
  }

  const parsed = new Date(raw as string);

  if (Number.isNaN(parsed.getTime())) {
    throw syncedAtInvalidError(SYNCED_AT_POINTER);
  }

  return parsed;
}

// Deliberately database-only: editing title/content does not touch
// filePath, status, or syncedAt. filePath is derived from the pre-edit
// title at creation time (server/utils/markdown.ts's buildFilename) and is
// left as-is here, and an already-synced record stays "synced" — a title or
// content fix does not re-queue the record for the CLI's next sync pass, so
// the file already written to the vault keeps its pre-edit name and body
// until some other event (a manual retry, a future re-sync feature) touches
// it. Re-deriving filePath and resetting status/syncedAt on every edit is a
// larger, separate decision (collision handling, whether every edit should
// force a re-sync) tracked as a follow-up rather than guessed at here.
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

  if (attributes.title !== undefined) {
    payload.title = attributes.title.trim();
  }

  if (attributes.content !== undefined) {
    payload.content = attributes.content;
  }

  return payload;
}

// Every other record mutation (create, delete, bulk status update) writes an
// activity event; a title/content edit is a user-initiated content rewrite —
// the most destructive single-record edit in the UI — so it gets the same
// trail. Scoped to title/content only: the machine-driven fields (status,
// syncedAt, filePath, errorMessage) are the CLI's routine sync-completion
// PATCH, which fires far more often and already has no event of its own —
// logging every one of those here would be a much bigger, unrelated
// behavior change than "let a user edit a record's title/content".
function logRecordEdit(
  userId: string,
  recordUuid: string,
  title: string,
): void {
  writeEvent({
    userId,
    kind: "dim",
    recordUuid,
    message: `Edited record "${title}"`,
  }).catch((writeError) => {
    console.error("[records/:uuid/patch] failed to write event:", writeError);
  });
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

    if (payload.title !== undefined || payload.content !== undefined) {
      logRecordEdit(userId, updated.uuid, updated.title);
    }

    const sourceTypeMap = await resolveSourceTypes(getDb(), userId, [
      updated.sourceId,
    ]);

    return { data: recordSerializer(withSourceType(updated, sourceTypeMap)) };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
