import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { records, type RecordStatus } from "../../db/schema";
import type { ApiRequest } from "../../types/api.types";
import { requireScope, requireUser } from "../../utils/auth";
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
  syncedAtNotSettableError,
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

// Annotated rather than compared against a magic string, so a status this
// endpoint stamps syncedAt for stays obvious at a glance (mirrors
// index.patch.ts's SYNCED_STATUS).
const SYNCED_STATUS: RecordStatus = "synced";

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
    "At least one of status, filePath, errorMessage, title, or content must be provided.",
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

// syncedAt is server-derived (see withServerDerivedSyncedAt below): the
// server stamps it itself when a status change moves a record to "synced",
// rather than trusting a client-supplied value. A client that still sends
// it — with or without a status change — gets a clear 422 rather than a
// value that's silently ignored (markpost#291, mirroring markpost#265's fix
// on the bulk endpoint).
function validateAttributes(attributes: PatchRecordAttributes): void {
  validateStatus(attributes);

  if ("syncedAt" in attributes) {
    throw syncedAtNotSettableError(SYNCED_AT_POINTER);
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

// filePath is deliberately left untouched by an edit, even now that a
// title/content change can re-queue the record (see withResyncOnEdit below):
// the CLI (markpost-cli's writeMarkdown) derives the on-disk filename fresh
// from the *current* title on every sync pass and never reads this column to
// decide where to write — it's a display/export value only (see the export
// endpoint and `markpost export`). Re-deriving it here would just relabel a
// value the CLI ignores, while regenerating it could also collide with
// another record's stored filePath for no behavioral gain.
function buildUpdatePayload(
  attributes: PatchRecordAttributes,
): RecordUpdatePayload {
  const payload: RecordUpdatePayload = {};

  if (attributes.status !== undefined) {
    payload.status = attributes.status;
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

type Database = ReturnType<typeof getDb>;

type RecordSyncState = {
  status: string;
  syncedAt: Date | null;
} | null;

// Shared by isNoOpSyncedUpdate and withResyncOnEdit below — both need to know
// this record's current status/syncedAt before deciding how to touch either
// one, and there's exactly one row to look it up from.
async function fetchRecordSyncState(
  db: Database,
  userId: string,
  recordUuid: string,
): Promise<RecordSyncState> {
  const [existing] = await db
    .select({ status: records.status, syncedAt: records.syncedAt })
    .from(records)
    .where(and(eq(records.userId, userId), eq(records.uuid, recordUuid)));

  return existing ?? null;
}

// A move to "synced" is a true no-op only when the record is already
// "synced" *and* already has a real syncedAt (mirrors resolveNoOpSyncedUuids
// in index.patch.ts, the bulk endpoint). Status alone would wrongly skip
// stamping a record created via POST with status "synced" but no syncedAt
// yet; syncedAt alone would wrongly skip a genuine pending/error -> synced
// re-sync that still carries an old syncedAt left over from before.
async function isNoOpSyncedUpdate(
  db: Database,
  userId: string,
  recordUuid: string,
): Promise<boolean> {
  const existing = await fetchRecordSyncState(db, userId, recordUuid);

  return existing?.status === SYNCED_STATUS && existing?.syncedAt != null;
}

// A title/content edit on a record the CLI already synced leaves that
// record's on-disk file stale (pre-edit name and body) until something
// re-queues it — this is that something (markpost#306). Scoped narrowly:
// - Only fires on a title/content edit; a status/filePath/errorMessage-only
//   ("metadata-only") update never touches the file the CLI writes, so it
//   must not re-queue.
// - Only fires when the client isn't already setting status itself — an
//   explicit status in the same request is the caller's own intent and wins
//   over this inference.
// - Only fires when the record's *current* status is "synced". A "pending"
//   record is already queued (the next sync pass reads this same row's
//   fresh title/content), and an "error" record has its own explicit retry
//   path rather than being silently re-queued as a side effect of fixing a
//   typo.
// filePath is intentionally left alone here (see buildUpdatePayload above).
async function withResyncOnEdit(
  db: Database,
  userId: string,
  recordUuid: string,
  payload: RecordUpdatePayload,
): Promise<RecordUpdatePayload> {
  const isEditingTitleOrContent =
    payload.title !== undefined || payload.content !== undefined;

  if (!isEditingTitleOrContent || payload.status !== undefined) {
    return payload;
  }

  const existing = await fetchRecordSyncState(db, userId, recordUuid);

  if (existing?.status !== SYNCED_STATUS) {
    return payload;
  }

  return { ...payload, status: "pending", syncedAt: null };
}

// Stamps syncedAt with the current time when the update moves the record to
// "synced" and doing so isn't a no-op; a move to pending/error (or no status
// change at all) never touches syncedAt, preserving the record's real last
// sync time. Returns a new payload rather than mutating the one it's given.
async function withServerDerivedSyncedAt(
  db: Database,
  userId: string,
  recordUuid: string,
  payload: RecordUpdatePayload,
): Promise<RecordUpdatePayload> {
  if (payload.status !== SYNCED_STATUS) {
    return payload;
  }

  const isNoOp = await isNoOpSyncedUpdate(db, userId, recordUuid);

  if (isNoOp) {
    return payload;
  }

  return { ...payload, syncedAt: new Date() };
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
    requireScope(event, "records:write");
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

    const payloadWithResync = await withResyncOnEdit(
      getDb(),
      userId,
      recordUuid,
      payload,
    );

    const payloadWithSyncedAt = await withServerDerivedSyncedAt(
      getDb(),
      userId,
      recordUuid,
      payloadWithResync,
    );

    const updated = await updateUserRecord(
      userId,
      recordUuid,
      payloadWithSyncedAt,
    );

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
