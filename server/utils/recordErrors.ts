import { ApiError } from "./errors";

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
