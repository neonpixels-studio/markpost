import type { ApiError as ApiErrorObject } from "../types/api.types";

const UNAUTHORIZED_STATUS = 401;
const FORBIDDEN_STATUS = 403;
const TOO_MANY_REQUESTS_STATUS = 429;

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

// Scope-gated handlers (requireScope in server/utils/auth.ts) share this shape
// so an under-scoped API token gets the same JSON:API `{ errors: [...] }`
// envelope as any other rejection, naming the missing scope so an agent can
// tell the difference between "not authenticated" (401) and "authenticated,
// but this token wasn't minted with that permission" (403).
export function forbiddenScopeError(scope: string): ApiError {
  return new ApiError(
    [
      {
        status: String(FORBIDDEN_STATUS),
        title: "Forbidden",
        detail: `This token does not have the required \`${scope}\` scope.`,
      },
    ],
    FORBIDDEN_STATUS,
  );
}

// Shared 429 envelope for every fixed-window throttle that rejects a request
// (currently the authenticated-API limiter in server/middleware/auth.ts; the
// webhook throttle in server/api/hooks/[slug].post.ts builds its own since it
// needs a webhook-specific detail message and 409-vs-429 semantics per
// provider). Callers are responsible for setting the Retry-After header
// themselves, since that requires the H3 event this function doesn't have.
export function tooManyRequestsError(detail: string): ApiError {
  return new ApiError(
    [
      {
        status: String(TOO_MANY_REQUESTS_STATUS),
        title: "Too Many Requests",
        detail,
      },
    ],
    TOO_MANY_REQUESTS_STATUS,
  );
}

// Shared 400 shape for a malformed/unrecognized query filter parameter —
// used by GET /api/records (filter[source]) and GET /api/events
// (filter[kind], filter[sourceId]). 400, not 422, because these validate
// query parameters, not body attributes.
export function invalidQueryParamError(
  parameter: string,
  detail: string,
): ApiError {
  return new ApiError(
    [
      {
        status: "400",
        title: `Invalid ${parameter}`,
        detail,
        source: { parameter },
      },
    ],
    400,
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

// Single throwing entry point for requireScope (server/utils/auth.ts), mirroring
// throwUnauthorized so every 403 also flows through apiErrorHandler.
export function throwForbiddenScope(scope: string): never {
  apiErrorHandler(forbiddenScopeError(scope));
}
