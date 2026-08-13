import type { ApiError as ApiErrorObject } from "../types/api.types";

const UNAUTHORIZED_STATUS = 401;

export class ApiError extends Error {
  readonly errors: ApiErrorObject[];
  readonly statusCode: number;

  constructor(errors: ApiErrorObject[], statusCode: number) {
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new RangeError(
        "ApiError statusCode must be an integer between 400 and 599",
      );
    }
    super(`ApiError: ${statusCode}`);
    this.errors = errors;
    this.statusCode = statusCode;
  }
}

// Auth failures (middleware token/session checks and requireUser) share this
// shape so a 401 body carries the same JSON:API `{ errors: [...] }` envelope
// every other endpoint emits, rather than a bare statusMessage with no
// machine-readable error detail for the client.
export function unauthorizedError(): ApiError {
  return new ApiError(
    [
      {
        status: String(UNAUTHORIZED_STATUS),
        title: "Unauthorized",
        detail: "Authentication is required to access this resource.",
      },
    ],
    UNAUTHORIZED_STATUS,
  );
}

function isHttpError(error: unknown): error is { statusCode: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  );
}

export function apiErrorHandler(error: unknown): never {
  if (error instanceof ApiError) {
    throw createError({
      statusCode: error.statusCode,
      data: { errors: error.errors },
    });
  }

  // Errors already carrying an HTTP statusCode (a createError thrown upstream,
  // or a 401 normalized by an earlier apiErrorHandler call) are client-facing;
  // re-throw them untouched rather than masking them as a generic 500.
  if (isHttpError(error)) {
    throw error;
  }

  console.error("[apiErrorHandler] Unexpected error:", error);

  throw createError({
    statusCode: 500,
    statusMessage: "Internal Server Error",
  });
}

// Single throwing entry point for the three auth call sites (the two middleware
// checks and requireUser) so the 401 always flows through the envelope machinery
// and no caller can accidentally throw a raw ApiError that skips apiErrorHandler.
export function throwUnauthorized(): never {
  apiErrorHandler(unauthorizedError());
}
