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

const [SYNCED_STATUS] = RECORD_STATUSES;

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
  syncedAt?: Date | null;
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
    "At least one of status, syncedAt, filePath, or errorMessage must be provided.",
    `${RECORDS_POINTER}/${index}`,
  );
}

function statusInvalidError(index: number): ApiError {
  return invalidAttributeError(
    `Status must be one of: ${RECORD_STATUSES.join(", ")}`,
    `${RECORDS_POINTER}/${index}/status`,
  );
}

function syncedAtTypeError(index: number): ApiError {
  return invalidAttributeError(
    "SyncedAt must be a date string or null",
    `${RECORDS_POINTER}/${index}/syncedAt`,
  );
}

function syncedAtInvalidError(index: number): ApiError {
  return invalidAttributeError(
    "SyncedAt must be a valid date string",
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

function parseSyncedAt(
  attributes: RecordUpdateAttributes,
  index: number,
  payload: RecordUpdatePayload,
): void {
  if (!("syncedAt" in attributes)) {
    return;
  }

  const raw = attributes.syncedAt;

  if (raw === null) {
    payload.syncedAt = null;
    return;
  }

  if (typeof raw !== "string") {
    throw syncedAtTypeError(index);
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw syncedAtInvalidError(index);
  }

  payload.syncedAt = parsed;
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
  parseSyncedAt(attributes, index, payload);
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

// Bulk status changes come from the client, but the client's view of "what
// was this record's status a moment ago" can't be trusted for syncedAt:
// a batch mixing already-synced and not-yet-synced rows would otherwise let
// the client re-stamp every row to "now" (inflating the "synced today" stat
// in server/api/records/stats.get.ts) or null out a real prior sync time on
// every row moved to pending/error, with no way to recover it. The database's
// own current status is the only trustworthy source, so it's read in one
// batched lookup (mirrors resolveSourceTypes above) before any row is
// updated, scoped to the owning user like every other read in this endpoint.
async function resolveCurrentStatuses(
  db: Database,
  userId: string,
  uuids: string[],
): Promise<Map<string, string>> {
  if (uuids.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({ uuid: records.uuid, status: records.status })
    .from(records)
    .where(and(eq(records.userId, userId), inArray(records.uuid, uuids)));

  return new Map(rows.map((row) => [row.uuid, row.status]));
}

// Ignores any client-supplied syncedAt whenever the update also changes
// status — status transitions own syncedAt, not the client. A record already
// synced never gets re-stamped by a further "mark synced" action, and moving
// a record to pending/error never touches syncedAt at all, preserving
// whatever real sync time was already recorded. A uuid the server has no
// record of yet (unknown to the caller, or a race with a delete) is treated
// as not-yet-synced, so it still gets stamped the first time it lands here.
function applyTrustedSyncedAt(
  update: PreparedUpdate,
  currentStatusByUuid: Map<string, string>,
): PreparedUpdate {
  if (update.payload.status === undefined) {
    return update;
  }

  const currentStatus = currentStatusByUuid.get(update.uuid);
  const isAlreadySynced = currentStatus === SYNCED_STATUS;
  const isMovingToSynced = update.payload.status === SYNCED_STATUS;

  if (!isMovingToSynced || isAlreadySynced) {
    delete update.payload.syncedAt;
    return update;
  }

  update.payload.syncedAt = new Date();
  return update;
}

function applyTrustedSyncedAtToAll(
  updates: PreparedUpdate[],
  currentStatusByUuid: Map<string, string>,
): PreparedUpdate[] {
  return updates.map((update) =>
    applyTrustedSyncedAt(update, currentStatusByUuid),
  );
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
      const statusChangeUuids = updates
        .filter((update) => update.payload.status !== undefined)
        .map((update) => update.uuid);
      const currentStatusByUuid = await resolveCurrentStatuses(
        getDb(),
        userId,
        statusChangeUuids,
      );
      const trustedUpdates = applyTrustedSyncedAtToAll(
        updates,
        currentStatusByUuid,
      );
      const updatedRecords = await applyUpdates(userId, trustedUpdates);

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
