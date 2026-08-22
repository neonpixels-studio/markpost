import { verifyWebhook, type WebhookEvent } from "@clerk/backend/webhooks";
import { ApiError } from "../utils/errors";

const CLERK_WEBHOOK_SIGNING_SECRET_ENV = "CLERK_WEBHOOK_SIGNING_SECRET";

// Standard Webhooks / Svix headers Clerk signs every delivery with. Verification
// needs all three plus the exact raw body. Exported so the route can read the
// delivery id for logging without re-hardcoding the header name.
export const SVIX_ID_HEADER = "svix-id";
const SVIX_TIMESTAMP_HEADER = "svix-timestamp";
const SVIX_SIGNATURE_HEADER = "svix-signature";

const SVIX_HEADERS = [
  SVIX_ID_HEADER,
  SVIX_TIMESTAMP_HEADER,
  SVIX_SIGNATURE_HEADER,
] as const;

export type ClerkWebhookEvent = WebhookEvent;

// A missing secret is our own misconfiguration, not a bad request, so it is a
// 503 (mirroring the Stripe billing webhook) — resolve it before verification
// so it is never mistaken for an invalid signature (400).
export function getClerkWebhookSigningSecret(): string {
  const secret = process.env[CLERK_WEBHOOK_SIGNING_SECRET_ENV];
  if (!secret) {
    throw new ApiError(
      [
        {
          status: "503",
          title: "Service Unavailable",
          detail: "Webhook secret is not configured.",
        },
      ],
      503,
    );
  }
  return secret;
}

function buildSvixRequest(
  rawBody: string,
  headers: Record<string, string | undefined>,
): Request {
  const requestHeaders = new Headers();
  SVIX_HEADERS.filter((name) => headers[name]).forEach((name) => {
    requestHeaders.set(name, headers[name] as string);
  });

  // Clerk's verifier reads the raw text and the Svix headers off a Fetch
  // Request; the URL is irrelevant to the HMAC, only the body and headers are
  // signed.
  return new Request("https://markpost.invalid/api/webhooks/clerk", {
    method: "POST",
    headers: requestHeaders,
    body: rawBody,
  });
}

// Verifies a Clerk webhook delivery against the Svix signature and returns the
// parsed event, or throws when the signature is missing/invalid. Isolated here
// (rather than inline in the route) so signature verification is swapped for a
// fake in tests and never hits the live @clerk/backend verifier.
export async function verifyClerkWebhookEvent(
  rawBody: string,
  headers: Record<string, string | undefined>,
  signingSecret: string,
): Promise<ClerkWebhookEvent> {
  const request = buildSvixRequest(rawBody, headers);
  return verifyWebhook(request, { signingSecret });
}
