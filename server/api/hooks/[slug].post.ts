import { eq, sql } from "drizzle-orm";
import type { H3Event } from "h3";
import { getDb } from "../../db";
import { records, sources, userSettings } from "../../db/schema";
import { apiErrorHandler, ApiError } from "../../utils/errors";
import { applyFieldMapping } from "../../utils/fieldMapper";
import { parseWebhookPayload, type UserSettings } from "../../utils/markdown";
import { ensureUniqueFilePath } from "../../utils/filePathCollision";
import { assertWithinRecordLimit } from "../../utils/planLimits";
import {
  GITHUB_SIGNATURE_HEADER,
  STRIPE_SIGNATURE_HEADER,
  verifyProviderSignature,
} from "../../utils/signatureVerifier";
import { writeEvent } from "../../utils/eventWriter";
import { recordWebhookHit } from "../../utils/webhookThrottle";
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

function notFoundError(): ApiError {
  return new ApiError(
    [
      {
        status: "404",
        title: "Not Found",
        detail: "No source was found for the given slug.",
      },
    ],
    404,
  );
}

function signatureError(reason: string): ApiError {
  return new ApiError(
    [
      {
        status: "401",
        title: "Unauthorized",
        detail: reason,
      },
    ],
    401,
  );
}

function throttledError(): ApiError {
  return new ApiError(
    [
      {
        status: "429",
        title: "Too Many Requests",
        detail:
          "This webhook source is receiving too many requests. Slow down and try again shortly.",
      },
    ],
    429,
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

async function insertWebhookRecord(
  source: SourceRow,
  parsed: ParsedWebhookResult,
) {
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
    })
    .returning();

  if (!created) {
    throw new ApiError(
      [
        {
          status: "500",
          title: "Internal Server Error",
          detail: "Failed to insert record",
        },
      ],
      500,
    );
  }

  return created;
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

function parseBodyToPayload(rawBody: string): Record<string, unknown> {
  if (!rawBody) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(rawBody);

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    // Non-JSON body: treat as empty payload; the parser will use defaults
    return {};
  }
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

async function buildAndInsertRecord(source: SourceRow, rawBody: string) {
  const payload = parseBodyToPayload(rawBody);
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
  return insertWebhookRecord(source, { ...parsed, filePath });
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
    const slug = getRouterParam(event, "slug");
    const source = await resolveAndValidateSource(slug);

    const rawBodyText = await readRawBody(event);
    const rawBody = rawBodyText ?? "";

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
    await assertWithinRecordLimit(source.userId);

    const record = await buildAndInsertRecord(source, rawBody);
    await writeBestEffortSideEffects(source, record);

    setResponseStatus(event, 202);
    return { data: { uuid: record.uuid } };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
