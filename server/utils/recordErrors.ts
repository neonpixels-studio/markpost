import { ApiError } from "./errors";
import { RECORD_STATUSES } from "../db/schema";

// Shared JSON:API error builders for the record endpoints. invalidUuidError and
// recordNotFoundError were duplicated verbatim across the show/patch handlers;
// filePathConflictError is shared by create and patch (both reject a colliding
// file_path with the same 409). Keeping one copy avoids drift in status/detail.

export function invalidUuidError(): ApiError {
  return new ApiError(
    [
      {
        status: "400",
        title: "Invalid Parameter",
        detail: "The uuid parameter is missing or malformed.",
        source: { parameter: "uuid" },
      },
    ],
    400,
  );
}

export function recordNotFoundError(): ApiError {
  return new ApiError(
    [
      {
        status: "404",
        title: "Not Found",
        detail: "No record was found for the given uuid.",
      },
    ],
    404,
  );
}

// Raised when a write would point a record at a (user, lower(file_path)) another
// record already owns (unique index from migration 0022). Surfaced as a 409 the
// client can act on rather than the raw Postgres 23505 → 500.
export function filePathConflictError(): ApiError {
  return new ApiError(
    [
      {
        status: "409",
        title: "Conflict",
        detail: "Another record already uses this file path.",
        source: { pointer: "/data/attributes/filePath" },
      },
    ],
    409,
  );
}

// The PATCH validation builders below are shared between the single-record
// (server/api/records/[uuid].patch.ts) and bulk (server/api/records/index.patch.ts)
// endpoints, which validate the same attribute shapes but point at different
// JSON pointers (a bare `/data/attributes/status` vs. an indexed
// `/data/attributes/records/0/status`) — each caller builds its own pointer
// and passes it in, so the message/status pairing can't drift between the two
// endpoints while the pointer stays endpoint-specific.
export function invalidAttributeError(
  detail: string,
  pointer: string,
): ApiError {
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

export function attributesShapeError(): ApiError {
  return invalidAttributeError(
    "Attributes must be an object.",
    "/data/attributes",
  );
}

export function statusInvalidError(pointer: string): ApiError {
  return invalidAttributeError(
    `Status must be one of: ${RECORD_STATUSES.join(", ")}`,
    pointer,
  );
}

// syncedAt is server-derived on status changes (see withServerDerivedSyncedAt
// in both index.patch.ts, the bulk endpoint, and [uuid].patch.ts, the
// single-record endpoint); a client that still sends it gets a clear 422
// rather than a value that's silently ignored (markpost#265 fixed the bulk
// endpoint; markpost#291 mirrored the fix on the single-record endpoint,
// since client-trusted syncedAt corrupted stats on either path).
export function syncedAtNotSettableError(pointer: string): ApiError {
  return invalidAttributeError(
    "SyncedAt is derived by the server from status changes and cannot be set directly.",
    pointer,
  );
}

export function filePathTypeError(pointer: string): ApiError {
  return invalidAttributeError("FilePath must be a string or null", pointer);
}

export function errorMessageTypeError(pointer: string): ApiError {
  return invalidAttributeError(
    "ErrorMessage must be a string or null",
    pointer,
  );
}
