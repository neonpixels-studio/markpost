import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { records, RECORD_STATUSES, type RecordStatus } from "../../db/schema";
import type { ApiRequest } from "../../types/api.types";
import { requireUser } from "../../utils/auth";
import { ApiError, apiErrorHandler } from "../../utils/errors";
import {
  recordSerializer,
  type RecordListApiResponse,
} from "../../utils/response";
import { isValidUuid } from "../../utils/uuid";
import { writeEvent } from "../../utils/eventWriter";
import { MAX_UPDATE_BATCH_SIZE } from "#shared/utils/records";
import { resolveSourceTypes, withSourceType } from "../../utils/sourceType";

// Annotated rather than destructured from RECORD_STATUSES by position, so a
// reorder of that array can't silently change which status this means.
const SYNCED_STATUS: RecordStatus = "synced";

type RecordUpdateAttributes = {
  uuid?: unknown;
  status?: unknown;
  syncedAt?: unknown;
  filePath?: unknown;
  errorMessage?: unknown;
};

type BulkPatchBody = ApiRequest & {
  data: {
    attributes: {
      records?: unknown;
    };
  };
};

type RecordUpdatePayload = {
  status?: string;
  syncedAt?: Date;
  filePath?: string | null;
  errorMessage?: string | null;
};

type PreparedUpdate = {
  uuid: string;
  payload: RecordUpdatePayload;
};

const RECORDS_POINTER = "/data/attributes/records";

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

function recordsShapeError(): ApiError {
  return invalidAttributeError(
    "Records is required and must be a non-empty array",
    RECORDS_POINTER,
  );
}

function recordsTooLargeError(): ApiError {
  return invalidAttributeError(
    `Records must not contain more than ${MAX_UPDATE_BATCH_SIZE} items`,
    RECORDS_POINTER,
  );
}

function duplicateUuidError(uuid: string): ApiError {
  return invalidAttributeError(
    `Records must not contain duplicate uuids: ${uuid}`,
    RECORDS_POINTER,
  );
}

function itemShapeError(index: number): ApiError {
  return invalidAttributeError(
    "Each record must be an object.",
    `${RECORDS_POINTER}/${index}`,
  );
}

function itemUuidError(index: number): ApiError {
  return invalidAttributeError(
    "Each record must include a valid uuid.",
    `${RECORDS_POINTER}/${index}/uuid`,
  );
}

function itemEmptyUpdateError(index: number): ApiError {
  return invalidAttributeError(
    "At least one of status, filePath, or errorMessage must be provided.",
    `${RECORDS_POINTER}/${index}`,
  );
}

function statusInvalidError(index: number): ApiError {
  return invalidAttributeError(
    `Status must be one of: ${RECORD_STATUSES.join(", ")}`,
    `${RECORDS_POINTER}/${index}/status`,
  );
}

// syncedAt is server-derived (see withServerDerivedSyncedAt below); a client
// that still sends it gets a clear 422 rather than a value that's silently
// ignored (markpost#265 — client-trusted syncedAt corrupted stats).
function syncedAtNotSettableError(index: number): ApiError {
  return invalidAttributeError(
    "SyncedAt is derived by the server from status changes and cannot be set directly.",
    `${RECORDS_POINTER}/${index}/syncedAt`,
  );
}

function filePathTypeError(index: number): ApiError {
  return invalidAttributeError(
    "FilePath must be a string or null",
    `${RECORDS_POINTER}/${index}/filePath`,
  );
}

function errorMessageTypeError(index: number): ApiError {
  return invalidAttributeError(
    "ErrorMessage must be a string or null",
    `${RECORDS_POINTER}/${index}/errorMessage`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordStatus(value: unknown): value is RecordStatus {
  return (
    typeof value === "string" &&
    (RECORD_STATUSES as readonly string[]).includes(value)
  );
}

function parseStatus(
  attributes: RecordUpdateAttributes,
  index: number,
  payload: RecordUpdatePayload,
): void {
  if (!("status" in attributes)) {
    return;
  }

  if (!isRecordStatus(attributes.status)) {
    throw statusInvalidError(index);
  }

  payload.status = attributes.status;
}

function rejectClientSyncedAt(
  attributes: RecordUpdateAttributes,
  index: number,
): void {
  if ("syncedAt" in attributes) {
    throw syncedAtNotSettableError(index);
  }
}

function parseFilePath(
  attributes: RecordUpdateAttributes,
  index: number,
  payload: RecordUpdatePayload,
): void {
  if (!("filePath" in attributes)) {
    return;
  }

  const raw = attributes.filePath;

  if (raw !== null && typeof raw !== "string") {
    throw filePathTypeError(index);
  }

  payload.filePath = raw ?? null;
}

function parseErrorMessage(
  attributes: RecordUpdateAttributes,
  index: number,
  payload: RecordUpdatePayload,
): void {
  if (!("errorMessage" in attributes)) {
    return;
  }

  const raw = attributes.errorMessage;

  if (raw !== null && typeof raw !== "string") {
    throw errorMessageTypeError(index);
  }

  payload.errorMessage = raw ?? null;
}

function buildItemPayload(
  attributes: RecordUpdateAttributes,
  index: number,
): RecordUpdatePayload {
  const payload: RecordUpdatePayload = {};

  parseStatus(attributes, index, payload);
  rejectClientSyncedAt(attributes, index);
  parseFilePath(attributes, index, payload);
  parseErrorMessage(attributes, index, payload);

  if (Object.keys(payload).length === 0) {
    throw itemEmptyUpdateError(index);
  }

  return payload;
}

function prepareItem(item: unknown, index: number): PreparedUpdate {
  if (!isPlainObject(item)) {
    throw itemShapeError(index);
  }

  const attributes = item as RecordUpdateAttributes;

  if (!isValidUuid(attributes.uuid as string | undefined)) {
    throw itemUuidError(index);
  }

  const payload = buildItemPayload(attributes, index);

  return { uuid: attributes.uuid as string, payload };
}

function assertNoDuplicateUuids(updates: PreparedUpdate[]): void {
  const seen = new Set<string>();

  updates.forEach((update) => {
    if (seen.has(update.uuid)) {
      throw duplicateUuidError(update.uuid);
    }

    seen.add(update.uuid);
  });
}

function prepareUpdates(body: BulkPatchBody): PreparedUpdate[] {
  const attributes = body?.data?.attributes ?? {};

  if (!isPlainObject(attributes)) {
    throw attributesShapeError();
  }

  const items = (attributes as { records?: unknown }).records;

  if (!Array.isArray(items) || items.length === 0) {
    throw recordsShapeError();
  }

  if (items.length > MAX_UPDATE_BATCH_SIZE) {
    throw recordsTooLargeError();
  }

  const updates = items.map((item, index) => prepareItem(item, index));

  assertNoDuplicateUuids(updates);

  return updates;
}

type Database = ReturnType<typeof getDb>;

// A uuid belongs in this set only when marking it "synced" would be a true
// no-op: status is already "synced" *and* it already has a real syncedAt.
// Status alone would wrongly skip a POST-created record that's "synced" with
// no syncedAt yet; syncedAt alone would wrongly skip a genuine pending/error
// -> synced re-sync that still has a syncedAt left over from before.
async function resolveNoOpSyncedUuids(
  db: Database,
  userId: string,
  uuids: string[],
): Promise<Set<string>> {
  if (uuids.length === 0) {
    return new Set();
  }

  const rows = await db
    .select({
      uuid: records.uuid,
      status: records.status,
      syncedAt: records.syncedAt,
    })
    .from(records)
    .where(and(eq(records.userId, userId), inArray(records.uuid, uuids)));

  return new Set(
    rows
      .filter((row) => row.status === SYNCED_STATUS && row.syncedAt !== null)
      .map((row) => row.uuid),
  );
}

// Stamps syncedAt with the current time unless resolveNoOpSyncedUuids says
// it'd be a no-op; a move to pending/error never touches syncedAt. Returns a
// new PreparedUpdate rather than mutating the one it's given.
function withServerDerivedSyncedAt(
  update: PreparedUpdate,
  noOpSyncedUuids: Set<string>,
): PreparedUpdate {
  const isMovingToSynced = update.payload.status === SYNCED_STATUS;
  const shouldStampNow = isMovingToSynced && !noOpSyncedUuids.has(update.uuid);

  if (!shouldStampNow) {
    return update;
  }

  return { ...update, payload: { ...update.payload, syncedAt: new Date() } };
}

async function applyUpdate(userId: string, update: PreparedUpdate) {
  const db = getDb();

  const [updated] = await db
    .update(records)
    .set(update.payload)
    .where(and(eq(records.userId, userId), eq(records.uuid, update.uuid)))
    .returning();

  return updated ?? null;
}

// Each update is scoped to the owner's records, so foreign or nonexistent
// uuids simply return no row and are dropped from the result — mirroring how
// the bulk delete endpoint reports only the records that actually matched.
async function applyUpdates(userId: string, updates: PreparedUpdate[]) {
  const results = await Promise.all(
    updates.map((update) => applyUpdate(userId, update)),
  );

  return results.filter((record) => record !== null);
}

function logBulkUpdate(userId: string, updatedCount: number): void {
  writeEvent({
    userId,
    kind: "dim",
    message: `Updated ${updatedCount} record${updatedCount === 1 ? "" : "s"}`,
  }).catch((writeError) => {
    console.error("[records/patch] failed to write event:", writeError);
  });
}

export default defineEventHandler(
  async (event): Promise<RecordListApiResponse> => {
    try {
      const userId = requireUser(event);
      const body = (await readBody(event)) as BulkPatchBody;

      const updates = prepareUpdates(body);
      // Only items moving to "synced" can ever consult the lookup below, so
      // that's what it's scoped to — a batch that only moves records to
      // pending/error skips the query entirely.
      const movingToSyncedUuids = updates
        .filter((update) => update.payload.status === SYNCED_STATUS)
        .map((update) => update.uuid);
      // Unlike resolveSourceTypes below (a display-only enrichment that
      // degrades to "unknown" on failure), this lookup feeds what actually
      // gets written — a failure here is left uncaught so it aborts the whole
      // batch via apiErrorHandler rather than risk writing under a guess.
      const noOpSyncedUuids = await resolveNoOpSyncedUuids(
        getDb(),
        userId,
        movingToSyncedUuids,
      );
      const updatesWithDerivedSyncedAt = updates.map((update) =>
        withServerDerivedSyncedAt(update, noOpSyncedUuids),
      );
      const updatedRecords = await applyUpdates(
        userId,
        updatesWithDerivedSyncedAt,
      );

      if (updatedRecords.length > 0) {
        logBulkUpdate(userId, updatedRecords.length);
      }

      const sourceTypeMap = await resolveSourceTypes(
        getDb(),
        userId,
        updatedRecords.map((record) => record.sourceId),
      );

      return {
        data: updatedRecords.map((record) =>
          recordSerializer(withSourceType(record, sourceTypeMap))!,
        ),
        meta: { updated: updatedRecords.length },
      };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
