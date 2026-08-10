import { reconcileAccountDeletion } from "../../services/accountDeletion";
import {
  verifyClerkWebhookEvent,
  getClerkWebhookSigningSecret,
  SVIX_ID_HEADER,
  type ClerkWebhookEvent,
} from "../../services/clerkWebhook";
import { apiErrorHandler, ApiError } from "../../utils/errors";

const USER_DELETED_EVENT = "user.deleted";

// The narrowed `user.deleted` variant, so `data.id` is read off the deleted-
// object payload rather than the whole webhook-event union.
type ClerkUserDeletedEvent = Extract<
  ClerkWebhookEvent,
  { type: typeof USER_DELETED_EVENT }
>;

function invalidSignatureError(): ApiError {
  return new ApiError(
    [
      {
        status: "400",
        title: "Bad Request",
        detail: "Invalid Clerk webhook signature.",
      },
    ],
    400,
  );
}

async function reconcileDeletedUser(
  userId: string,
  svixId: string | undefined,
): Promise<void> {
  // Clerk already removed the identity (this event is the notification), so
  // skip the Clerk-side delete and only reconcile Stripe + app data. A teardown
  // failure propagates as a non-2xx so Svix redelivers; retries are finite, so
  // if they run out the error log below (with the delivery id) is the only
  // trace to reconcile the account by hand.
  try {
    await reconcileAccountDeletion(userId, { deleteClerkIdentity: false });
  } catch (error) {
    console.error(
      "[webhooks/clerk] reconcile failed; Clerk will redeliver until retries are exhausted",
      { userId, svixId, error },
    );
    throw error;
  }
}

async function handleUserDeleted(
  webhookEvent: ClerkUserDeletedEvent,
  svixId: string | undefined,
): Promise<void> {
  const userId = webhookEvent.data.id;
  // A `user.deleted` payload without an id can't be reconciled to a row, so the
  // account's data/billing can't be cleaned up automatically. Log at error with
  // the delivery id so it can be traced and handled by hand.
  if (!userId) {
    console.error(
      "[webhooks/clerk] user.deleted missing user id; cannot reconcile",
      { svixId },
    );
    return;
  }

  await reconcileDeletedUser(userId, svixId);
}

async function dispatchClerkEvent(
  webhookEvent: ClerkWebhookEvent,
  svixId: string | undefined,
): Promise<void> {
  if (webhookEvent.type === USER_DELETED_EVENT) {
    await handleUserDeleted(webhookEvent, svixId);
  }
}

// Verify or reject as a 400, extracted so the handler body stays a flat
// sequence (no nested try/catch). Any verification failure — missing headers,
// bad signature, malformed body — becomes a 400 with no side effects.
async function verifyOrReject(
  rawBody: string,
  headers: Record<string, string | undefined>,
  signingSecret: string,
): Promise<ClerkWebhookEvent> {
  try {
    return await verifyClerkWebhookEvent(rawBody, headers, signingSecret);
  } catch (error) {
    console.warn("[webhooks/clerk] signature verification failed", { error });
    throw invalidSignatureError();
  }
}

export default defineEventHandler(async (event) => {
  try {
    const rawBodyText = await readRawBody(event);
    const rawBody = rawBodyText ?? "";
    const headers = getHeaders(event);

    // Resolve the secret before verification: a missing secret is a 503 config
    // error, not a 400 bad-signature, so it must not be caught by verifyOrReject.
    const signingSecret = getClerkWebhookSigningSecret();
    const webhookEvent = await verifyOrReject(rawBody, headers, signingSecret);

    await dispatchClerkEvent(webhookEvent, headers[SVIX_ID_HEADER]);

    return { data: { received: true } };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
