import { ApiError } from "./errors";

// Caps the raw body an unauthenticated /api/hooks/:slug delivery may carry. The
// endpoint only needs a slug to reach and stores the body in the unbounded
// records.content column, so without a cap a single oversized request per rate
// window could bloat storage and memory (rate limiting caps request count, not
// payload size). 1 MiB comfortably fits real webhook payloads (Stripe/GitHub
// events, Zapier/Shortcuts posts) while rejecting abuse.
export const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

export const CONTENT_LENGTH_HEADER = "content-length";

function payloadTooLargeError(): ApiError {
  return new ApiError(
    [
      {
        status: "413",
        title: "Payload Too Large",
        detail: `Webhook payload exceeds the maximum allowed size of ${MAX_WEBHOOK_BODY_BYTES} bytes.`,
      },
    ],
    413,
  );
}

// Rejects an oversized delivery by its declared Content-Length before the body
// is buffered into memory. A missing or non-numeric header is a no-op here; the
// post-read byte check is the backstop for that case.
export function assertContentLengthWithinLimit(
  contentLengthHeader: string | undefined,
): void {
  if (!contentLengthHeader) {
    return;
  }

  const declaredBytes = Number(contentLengthHeader);

  // Content-Length is a non-negative integer per RFC 9110; anything else
  // (negative, fractional, hex, NaN) is not a value we can trust as the strict
  // guard, so defer to the post-read byte check rather than acting on it.
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
    return;
  }

  if (declaredBytes > MAX_WEBHOOK_BODY_BYTES) {
    throw payloadTooLargeError();
  }
}

// Backstop for a missing or dishonest Content-Length: measures the decoded body
// that is about to be parsed and stored as record content, which is exactly the
// storage-bloat threat this cap defends against. readRawBody already buffered it
// (h3 has no streaming size guard), so the Content-Length pre-check is what
// bounds pre-buffer memory for honest clients.
export function assertBodyWithinLimit(rawBody: string): void {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    throw payloadTooLargeError();
  }
}
