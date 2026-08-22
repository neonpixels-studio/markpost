import { and, eq, sql } from "drizzle-orm";
import type { H3Event } from "h3";
import { getDb } from "../../db";
import { records, sources, userSettings } from "../../db/schema";
import { apiErrorHandler, ApiError } from "../../utils/errors";
import { applyFieldMapping } from "../../utils/fieldMapper";
import { parseWebhookPayload, type UserSettings } from "../../utils/markdown";
import {
  ensureUniqueFilePath,
  insertRecordWithUniqueFilePath,
} from "../../utils/filePathCollision";
import { assertWithinRecordLimit } from "../../utils/planLimits";
import {
  GITHUB_PROVIDER,
  GITHUB_SIGNATURE_HEADER,
  normalizeProvider,
  STRIPE_SIGNATURE_HEADER,
  verifyProviderSignature,
} from "../../utils/signatureVerifier";
import { writeEvent } from "../../utils/eventWriter";
import {
  extractDeliveryId,
  GITHUB_DELIVERY_HEADER,
} from "../../utils/webhookDelivery";
import { recordWebhookHit } from "../../utils/webhookThrottle";
import {
  assertBodyWithinLimit,
  assertContentLengthWithinLimit,
  CONTENT_LENGTH_HEADER,
} from "../../utils/webhookBodyLimit";
import { SHARED_SECRET_HEADER } from "#shared/utils/webhookSecrets";

const DEFAULT_FILENAME_TEMPLATE = "{{date}}-{{slug}}.md";
const RECORD_STATUS_PENDING = "pending";
const RECORD_STATUS_ERROR = "error";
const EVENT_KIND_OK = "ok";
const EVENT_KIND_ERR = "err";

type SourceRow = {
  uuid: string;
  userId: string;
  type: string;
  name: string;
  provider: string | null;
  providerSecret: string | null;
  fieldMapping: unknown;
};

type UserSettingsRow = {
  filenameTemplate: string;
};

const NON_OBJECT_BODY_DETAIL =
  "Webhook body must be a JSON object. Send a JSON object payload with Content-Type: application/json.";

function apiError(httpStatus: number, title: string, detail: string): ApiError {
  return new ApiError(
    [{ status: String(httpStatus), title, detail }],
    httpStatus,
  );
}

function notFoundError(): ApiError {
  return apiError(404, "Not Found", "No source was found for the given slug.");
}

function signatureError(reason: string): ApiError {
  return apiError(401, "Unauthorized", reason);
}

function badRequestError(detail: string): ApiError {
  return apiError(400, "Bad Request", detail);
}

function throttledError(): ApiError {
  return apiError(
    429,
    "Too Many Requests",
    "This webhook source is receiving too many requests. Slow down and try again shortly.",
  );
}

async function resolveSourceBySlug(slug: string): Promise<SourceRow | null> {
  const db = getDb();
  const [row] = await db
    .select({
      uuid: sources.uuid,
      userId: sources.userId,
      type: sources.type,
      name: sources.name,
      provider: sources.provider,
      providerSecret: sources.providerSecret,
      fieldMapping: sources.fieldMapping,
    })
    .from(sources)
    .where(eq(sources.endpointSlug, slug))
    .limit(1);

  return row ?? null;
}

async function fetchUserSettings(userId: string): Promise<UserSettingsRow> {
  const db = getDb();
  const [row] = await db
    .select({ filenameTemplate: userSettings.filenameTemplate })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  return {
    filenameTemplate: row?.filenameTemplate ?? DEFAULT_FILENAME_TEMPLATE,
  };
}

type ParsedWebhookResult = {
  title: string;
  body: string;
  tags: string[];
  frontmatter: unknown;
  filePath: string;
};

type IngestedRecord = { uuid: string; title: string };

// onConflictDoNothing on the (source_id, delivery_id) unique index absorbs the
// race the app-level pre-check can't: two identical deliveries arriving at once
// both miss findRecordByDelivery, but only one insert lands — the other returns
// no row. A NULL delivery_id never conflicts (Postgres treats NULLs as
// distinct), so slug-only sources always insert here as before. A null return
// therefore means either that race (deliveryId set) or a genuine insert failure
// (deliveryId null); the caller distinguishes the two.
async function insertWebhookRecord(
  source: SourceRow,
  parsed: ParsedWebhookResult,
  deliveryId: string | null,
): Promise<IngestedRecord | null> {
  const db = getDb();
  const [created] = await db
    .insert(records)
    .values({
      userId: source.userId,
      title: parsed.title,
      content: parsed.body,
      sourceId: source.uuid,
      source: source.name,
      status: RECORD_STATUS_PENDING,
      tags: parsed.tags,
      frontmatter: parsed.frontmatter,
      filePath: parsed.filePath,
      deliveryId,
    })
    .onConflictDoNothing({
      target: [records.sourceId, records.deliveryId],
    })
    .returning();

  return created ?? null;
}

async function findRecordByDelivery(
  sourceId: string,
  deliveryId: string,
): Promise<IngestedRecord | null> {
  const db = getDb();
  const [row] = await db
    .select({ uuid: records.uuid, title: records.title })
    .from(records)
    .where(
      and(eq(records.sourceId, sourceId), eq(records.deliveryId, deliveryId)),
    )
    .limit(1);

  return row ?? null;
}

async function updateSourceStats(sourceId: string): Promise<void> {
  const db = getDb();
  await db
    .update(sources)
    .set({
      lastHitAt: new Date(),
      recordCount: sql`${sources.recordCount} + 1`,
    })
    .where(eq(sources.uuid, sourceId));
}

async function markRecordError(
  recordUuid: string,
  errorMessage: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(records)
    .set({
      status: RECORD_STATUS_ERROR,
      errorMessage,
    })
    .where(eq(records.uuid, recordUuid));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildProviderHeaders(
  event: H3Event,
): Record<string, string | undefined> {
  return {
    [STRIPE_SIGNATURE_HEADER]:
      getHeader(event, STRIPE_SIGNATURE_HEADER) ?? undefined,
    [GITHUB_SIGNATURE_HEADER]:
      getHeader(event, GITHUB_SIGNATURE_HEADER) ?? undefined,
    [SHARED_SECRET_HEADER]: getHeader(event, SHARED_SECRET_HEADER) ?? undefined,
  };
}

function asJsonObject(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// GitHub's webhook "Content type" defaults to application/x-www-form-urlencoded,
// which delivers the JSON payload URL-encoded under a `payload` form field. The
// HMAC in X-Hub-Signature-256 is computed over that raw form body, so the
// signature still verifies — we only have to unwrap `payload` before parsing.
// Gated to GitHub sources so a generic form-encoded body from any other source
// is still rejected rather than silently unwrapping a `payload` field.
function githubFormPayload(rawBody: string): Record<string, unknown> | null {
  const encoded = new URLSearchParams(rawBody).get("payload");
  return encoded ? asJsonObject(encoded) : null;
}

function parseWebhookBody(
  source: SourceRow,
  rawBody: string,
): Record<string, unknown> | null {
  const directObject = asJsonObject(rawBody);

  if (directObject) {
    return directObject;
  }

  // normalizeProvider is the single normalization boundary for provider identity
  // (see signatureVerifier.ts) — compare through it so a stored `"GitHub"` still
  // dispatches to the form-encoded unwrap it just verified the signature against.
  if (normalizeProvider(source.provider) === GITHUB_PROVIDER) {
    return githubFormPayload(rawBody);
  }

  return null;
}

// Fail loud on anything that isn't a JSON object. Accepted: a raw JSON object
// body (Stripe, Zapier, Apple Shortcuts, and GitHub when set to
// Content-Type: application/json) or, for GitHub sources, its default
// form-encoded `payload` wrapper. Everything else — a plain-text/other
// form-encoded body, a JSON scalar/array, or an empty body — is rejected with a
// 400; each would otherwise be coerced to {} and ingested as a blank "Untitled"
// record with a 202, hiding a misconfigured integration. (An empty body throws
// in JSON.parse, so asJsonObject already returns null for it.)
function requireJsonObjectBody(
  source: SourceRow,
  rawBody: string,
): Record<string, unknown> {
  const payload = parseWebhookBody(source, rawBody);

  if (!payload) {
    throw badRequestError(NON_OBJECT_BODY_DETAIL);
  }

  return payload;
}

async function resolveAndValidateSource(
  slug: string | undefined,
): Promise<SourceRow> {
  if (!slug) {
    throw notFoundError();
  }

  const source = await resolveSourceBySlug(slug);

  if (!source) {
    throw notFoundError();
  }

  return source;
}

// Every provider's secret now lives on the source row itself: Stripe's is
// user-supplied at creation (Stripe assigns it, we can't generate it), and
// GitHub/Zapier/Shortcuts' are generated by us. There is no longer a global
// env-var fallback for sources here — STRIPE_WEBHOOK_SECRET still exists, but
// only for the app's own billing webhook (server/api/billing/webhook.post.ts),
// which is a separate concern from user-created sources.
function checkSignature(
  source: SourceRow,
  providerHeaders: Record<string, string | undefined>,
  rawBody: string,
): void {
  const sigResult = verifyProviderSignature({
    provider: source.provider,
    headers: providerHeaders,
    rawBody,
    secret: source.providerSecret,
  });

  if (!sigResult.ok) {
    throw signatureError(sigResult.reason);
  }
}

const RETRY_AFTER_HEADER = "Retry-After";

async function enforceThrottle(
  event: H3Event,
  source: SourceRow,
): Promise<void> {
  const throttleResult = await recordWebhookHit(source.uuid);

  if (throttleResult.allowed) {
    return;
  }

  setHeader(
    event,
    RETRY_AFTER_HEADER,
    String(throttleResult.retryAfterSeconds),
  );
  throw throttledError();
}

type IngestOutcome = { record: IngestedRecord; deduped: boolean };

async function buildAndInsertRecord(
  source: SourceRow,
  payload: Record<string, unknown>,
  deliveryId: string | null,
): Promise<IngestOutcome> {
  const webhookPayload = applyFieldMapping(
    payload,
    source.fieldMapping,
    source.name,
  );

  const settingsRow = await fetchUserSettings(source.userId);
  const userSettingsValues: UserSettings = {
    filenameTemplate: settingsRow.filenameTemplate,
  };

  const parsed = parseWebhookPayload(webhookPayload, userSettingsValues);
  const filePath = await ensureUniqueFilePath(source.userId, parsed.filePath);
  // Two independent conflicts can arise on insert. A (source_id, delivery_id)
  // duplicate is absorbed by insertWebhookRecord's onConflictDoNothing, which
  // returns null (a dedup hit, resolved below). A file_path unique violation is
  // NOT in that conflict target, so it still throws a 23505 that
  // insertRecordWithUniqueFilePath catches and retries with a re-suffixed path.
  // Wrapping the delivery-id-aware insert in the file-path retry composes both:
  // delivery-id dedup wins first (the row never inserts, so the file_path index
  // is never checked); a genuine path collision retries.
  const created = await insertRecordWithUniqueFilePath(
    source.userId,
    filePath,
    (resolvedFilePath) =>
      insertWebhookRecord(
        source,
        { ...parsed, filePath: resolvedFilePath },
        deliveryId,
      ),
    parsed.filePath,
  );

  if (created) {
    return { record: created, deduped: false };
  }

  return resolveInsertConflict(source, deliveryId);
}

// insertWebhookRecord returned no row. With a delivery id that means a
// concurrent duplicate won the insert race — return its record as a dedup hit
// so this delivery still gets a 202 with the canonical uuid. Without one it is
// a genuine insert failure, which must fail loud.
async function resolveInsertConflict(
  source: SourceRow,
  deliveryId: string | null,
): Promise<IngestOutcome> {
  if (!deliveryId) {
    throw apiError(500, "Internal Server Error", "Failed to insert record");
  }

  const existing = await findRecordByDelivery(source.uuid, deliveryId);

  if (!existing) {
    throw apiError(500, "Internal Server Error", "Failed to insert record");
  }

  return { record: existing, deduped: true };
}

// Pre-insert idempotency guard: a provider retry carrying an already-ingested
// delivery id returns the existing record without touching the plan-limit
// budget or inserting again. Runs before assertWithinRecordLimit so a user at
// their cap can still be told a retried delivery already landed instead of a
// spurious 403.
async function findAlreadyIngested(
  source: SourceRow,
  deliveryId: string | null,
): Promise<IngestedRecord | null> {
  if (!deliveryId) {
    return null;
  }

  return findRecordByDelivery(source.uuid, deliveryId);
}

function buildDeliveryHeaders(
  event: H3Event,
): Record<string, string | undefined> {
  return {
    [GITHUB_DELIVERY_HEADER]:
      getHeader(event, GITHUB_DELIVERY_HEADER) ?? undefined,
  };
}

// The record already exists at this point (writeBestEffortSideEffects is only ever
// called after a successful insert), so unlike the outer handler catch, we know
// there is a real record to mark. The record's own content was parsed and stored
// fine; what failed is confirming that in the activity log. We still flag the
// record so the failure is visible in-app rather than only in server logs, but the
// event/record messages deliberately say "failed to confirm", not "ingestion
// failed" — the 202 response that follows is telling the sender the truth. Both
// writes are themselves best-effort (each swallows its own failure) so this must
// not throw, or it would defeat the "don't roll back the 202 response" guarantee.
async function recordIngestEventFailure(
  source: SourceRow,
  record: { uuid: string; title: string },
  writeError: unknown,
): Promise<void> {
  console.error("[hooks/ingest] failed to write event:", writeError);

  const errorMessage = toErrorMessage(writeError);

  await Promise.all([
    markRecordError(record.uuid, errorMessage).catch((markError) => {
      console.error("[hooks/ingest] failed to mark record error:", markError);
    }),
    writeEvent({
      userId: source.userId,
      kind: EVENT_KIND_ERR,
      message: `Failed to confirm webhook ingestion: ${errorMessage}`,
      recordUuid: record.uuid,
      sourceId: source.uuid,
    }).catch((errEventError) => {
      console.error("[hooks/ingest] failed to write err event:", errEventError);
    }),
  ]);
}

async function writeBestEffortSideEffects(
  source: SourceRow,
  record: { uuid: string; title: string },
): Promise<void> {
  // Stats and event writes are independent best-effort operations: run concurrently
  // so failures in one do not delay the other, and neither rolls back the record
  // or changes the 202 response, preventing cascading failures on a single ingest.
  await Promise.allSettled([
    updateSourceStats(source.uuid).catch((updateError) => {
      console.error(
        "[hooks/ingest] failed to update source stats:",
        updateError,
      );
    }),
    writeEvent({
      userId: source.userId,
      kind: EVENT_KIND_OK,
      message: `Webhook received: ${record.title}`,
      recordUuid: record.uuid,
      sourceId: source.uuid,
    }).catch((writeError) =>
      recordIngestEventFailure(source, record, writeError),
    ),
  ]);
}

export default defineEventHandler(async (event) => {
  try {
    // Reject an oversized delivery by its declared Content-Length first: the
    // check is slug-independent and leaks nothing, so it sheds a flood of
    // oversized bodies before the source lookup, the body buffer, signature
    // verification, or the throttle. The post-read byte check below backstops a
    // missing or dishonest header.
    assertContentLengthWithinLimit(getHeader(event, CONTENT_LENGTH_HEADER));

    const slug = getRouterParam(event, "slug");
    const source = await resolveAndValidateSource(slug);

    const rawBodyText = await readRawBody(event);
    const rawBody = rawBodyText ?? "";

    assertBodyWithinLimit(rawBody);

    // Verify the signature before spending throttle budget: HMAC verification
    // is cheap and stateless, so checking it first stops an attacker who only
    // knows the slug (but not the provider secret) from burning a signed
    // source's shared window with junk requests and 429-ing legitimate,
    // correctly-signed deliveries. No-provider sources verify as a no-op, so
    // this reordering does not weaken protection for the slug-only flood case
    // the throttle primarily exists for.
    const providerHeaders = buildProviderHeaders(event);
    checkSignature(source, providerHeaders, rawBody);

    // Throttle before the plan-limit check: recordWebhookHit must observe every
    // request that gets this far, or a user sitting at their monthly cap would
    // throw past the throttle on each delivery and never register in the window.
    // It is also the cheaper guard, so it sheds load before the subscription
    // lookup and monthly COUNT that assertWithinRecordLimit runs.
    await enforceThrottle(event, source);

    // Validate the body before the plan-limit check: a malformed delivery will
    // never create a record, so it must not consume the user's plan-limit budget
    // (assertWithinRecordLimit's subscription lookup + monthly COUNT). Kept after
    // enforceThrottle so a slug-only flood of junk bodies still counts against the
    // throttle window (see the reasoning on enforceThrottle above).
    const payload = requireJsonObjectBody(source, rawBody);

    // Idempotency: a provider (Stripe/GitHub) re-sends the same delivery on any
    // non-2xx or timeout. Skip an already-ingested delivery so retries return
    // the original record instead of creating a duplicate. Runs before the
    // plan-limit check so a retry never burns budget or 403s on a record that
    // already counted.
    const deliveryId = extractDeliveryId(
      source.provider,
      buildDeliveryHeaders(event),
      payload,
    );
    const alreadyIngested = await findAlreadyIngested(source, deliveryId);

    if (alreadyIngested) {
      setResponseStatus(event, 202);
      return { data: { uuid: alreadyIngested.uuid } };
    }

    await assertWithinRecordLimit(source.userId);

    const { record, deduped } = await buildAndInsertRecord(
      source,
      payload,
      deliveryId,
    );

    // A dedup hit means this delivery's record already exists, so its side
    // effects are skipped: re-running them on every normal retry would
    // double-count recordCount and emit a duplicate "received" event for one
    // logical delivery. The tradeoff is that if the very first delivery crashed
    // after committing the insert but before its side effects ran, a later retry
    // won't re-fire them (recordCount under-counts by one, no ok event). That
    // rare crash-window loss is preferred over over-counting every honest retry;
    // making side effects idempotent to close it is tracked as a follow-up.
    if (!deduped) {
      await writeBestEffortSideEffects(source, record);
    }

    setResponseStatus(event, 202);
    return { data: { uuid: record.uuid } };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
