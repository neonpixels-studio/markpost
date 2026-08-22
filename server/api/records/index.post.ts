import { eq, and } from "drizzle-orm";
import { getDb } from "../../db";
import {
  records,
  sources,
  userSettings,
  RECORD_STATUSES,
} from "../../db/schema";
import type { ApiRequest } from "../../types/api.types";
import { requireUser } from "../../utils/auth";
import { apiErrorHandler, ApiError } from "../../utils/errors";
import {
  parseWebhookPayload,
  parseEmailPayload,
  type WebhookPayload,
  type EmailPayload,
  type UserSettings,
} from "../../utils/markdown";
import { recordSerializer, type RecordApiResponse } from "../../utils/response";
import {
  ensureUniqueFilePath,
  insertRecordWithUniqueFilePath,
  isFilePathUniqueViolation,
} from "../../utils/filePathCollision";
import { filePathConflictError } from "../../utils/recordErrors";
import {
  apiValidate,
  isAbsent,
  type AttributeRule,
} from "../../utils/validate";
import { writeEvent } from "../../utils/eventWriter";
import { assertWithinRecordLimit } from "../../utils/planLimits";

const DEFAULT_FILENAME_TEMPLATE = "{{date}}-{{slug}}.md";

type CreateRecordAttributes = {
  title?: string;
  content?: string;
  // html triggers the Markdown pipeline: converted to content + frontmatter + tags + filePath
  html?: string;
  // payloadType controls which parser runs when html is present; defaults to "webhook"
  payloadType?: "webhook" | "email";
  sourceId?: string | null;
  source?: string | null;
  // status, syncedAt, filePath, and errorMessage are intentionally client-settable on create
  // to support import flows (e.g. CLI bulk-importing already-synced records).
  status?: string;
  filePath?: string | null;
  tags?: unknown;
  frontmatter?: unknown;
  syncedAt?: unknown;
  errorMessage?: string | null;
  // passed through to email parser when payloadType is "email"
  emailFrom?: string | null;
  created?: string | null;
};

type CreateRecordBody = {
  data?: {
    type?: string;
    attributes?: CreateRecordAttributes;
  };
};

const PAYLOAD_TYPES = ["webhook", "email"] as const;

const VALIDATION_RULES: AttributeRule[] = [
  { key: "title", type: "string" },
  // content is optional when html is provided; the pipeline derives content from html
  { key: "content", type: "string", optional: true },
  { key: "html", type: "string", optional: true },
  { key: "payloadType", type: "string", optional: true, enum: PAYLOAD_TYPES },
  { key: "sourceId", type: "string", optional: true },
  { key: "source", type: "string", optional: true },
  { key: "status", type: "string", optional: true, enum: RECORD_STATUSES },
  { key: "filePath", type: "string", optional: true },
  { key: "errorMessage", type: "string", optional: true },
];

// Scalar optional keys that are copied to the insert values as-is (no coercion needed).
const SCALAR_OPTIONAL_KEYS = [
  "sourceId",
  "source",
  "status",
  "filePath",
  "tags",
  "frontmatter",
  "errorMessage",
] as const;

type Database = ReturnType<typeof getDb>;

type ScalarOptionalKey = (typeof SCALAR_OPTIONAL_KEYS)[number];

type InsertRecordValues = {
  userId: string;
  title: string;
  content: string;
  sourceId?: string | null;
  source?: string | null;
  status?: string;
  filePath?: string | null;
  tags?: unknown;
  frontmatter?: unknown;
  syncedAt?: Date | null;
  errorMessage?: string | null;
};

function invalidAttribute(detail: string, pointer: string): ApiError {
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

function parseSyncedAt(raw: unknown): Date | null {
  if (raw === null) {
    return null;
  }

  if (typeof raw !== "string") {
    throw invalidAttribute(
      "SyncedAt must be a date string",
      "/data/attributes/syncedAt",
    );
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw invalidAttribute(
      "SyncedAt must be a valid date string",
      "/data/attributes/syncedAt",
    );
  }

  return parsed;
}

function validateTagsShape(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  if (!Array.isArray(value)) {
    throw invalidAttribute("Tags must be an array", "/data/attributes/tags");
  }
}

function validateFrontmatterShape(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw invalidAttribute(
      "Frontmatter must be an object",
      "/data/attributes/frontmatter",
    );
  }
}

function validateContentOrHtml(attributes: CreateRecordAttributes): void {
  if (!isAbsent(attributes.content) || !isAbsent(attributes.html)) {
    return;
  }

  throw new ApiError(
    [
      {
        status: "422",
        title: "Invalid Attribute",
        detail: "Content or html is required",
        source: { pointer: "/data/attributes/content" },
      },
    ],
    422,
  );
}

async function fetchFilenameTemplate(
  database: Database,
  userId: string,
): Promise<string> {
  const [row] = await database
    .select({ filenameTemplate: userSettings.filenameTemplate })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  return row?.filenameTemplate ?? DEFAULT_FILENAME_TEMPLATE;
}

type ResolvedContent = {
  content: string;
  frontmatter: unknown;
  tags: unknown;
  filePath: string | null;
};

function buildEmailPayload(attributes: CreateRecordAttributes): EmailPayload {
  return {
    subject: attributes.title,
    html: attributes.html,
    from: attributes.emailFrom ?? undefined,
    tags: Array.isArray(attributes.tags)
      ? (attributes.tags as string[])
      : undefined,
    date: attributes.created ?? undefined,
  };
}

function buildWebhookPayload(
  attributes: CreateRecordAttributes,
): WebhookPayload {
  return {
    title: attributes.title,
    html: attributes.html,
    source: attributes.source ?? undefined,
    tags: Array.isArray(attributes.tags)
      ? (attributes.tags as string[])
      : undefined,
    created: attributes.created ?? undefined,
  };
}

function parsedPayloadToResolvedContent(parsed: {
  body: string;
  frontmatter: unknown;
  tags: string[];
  filePath: string;
}): ResolvedContent {
  return {
    content: parsed.body,
    frontmatter: parsed.frontmatter,
    tags: parsed.tags,
    filePath: parsed.filePath,
  };
}

function resolveContentFromHtml(
  attributes: CreateRecordAttributes,
  settings: UserSettings,
): ResolvedContent {
  const payloadType = attributes.payloadType ?? "webhook";

  if (payloadType === "email") {
    const emailPayload = buildEmailPayload(attributes);
    return parsedPayloadToResolvedContent(
      parseEmailPayload(emailPayload, settings),
    );
  }

  const webhookPayload = buildWebhookPayload(attributes);
  return parsedPayloadToResolvedContent(
    parseWebhookPayload(webhookPayload, settings),
  );
}

// Mirrors the `attributes.filePath ?? resolved.filePath` fallback, but
// disambiguates the *generated* path against existing records so two ingests
// that collapse to the same name no longer map to one file. A client-supplied
// filePath (import flow) is intentional and passes through untouched.
async function resolveGeneratedFilePath(
  userId: string,
  clientFilePath: string | null | undefined,
  generatedFilePath: string | null,
): Promise<string | null> {
  if (clientFilePath !== undefined && clientFilePath !== null) {
    return clientFilePath;
  }

  // Either "" or null here; preserve it as-is to match the prior
  // `attributes.filePath ?? resolved.filePath` fallback.
  if (!generatedFilePath) {
    return generatedFilePath;
  }

  return ensureUniqueFilePath(userId, generatedFilePath);
}

type MarkdownPipelineResult = {
  attributes: CreateRecordAttributes;
  // The un-suffixed generated path (null when html is absent or no path was
  // generated). Used as the re-resolution base on a concurrent-insert retry so
  // suffixes grow off the true stem (hello-2, hello-3) instead of nesting
  // (hello-2-2) when the pre-insert lookup already suffixed attributes.filePath.
  generatedFilePath: string | null;
};

async function applyMarkdownPipeline(
  attributes: CreateRecordAttributes,
  database: Database,
  userId: string,
): Promise<MarkdownPipelineResult> {
  if (isAbsent(attributes.html)) {
    return { attributes, generatedFilePath: null };
  }

  const filenameTemplate = await fetchFilenameTemplate(database, userId);
  const userSettingsValues: UserSettings = { filenameTemplate };

  const resolved = resolveContentFromHtml(attributes, userSettingsValues);
  const filePath = await resolveGeneratedFilePath(
    userId,
    attributes.filePath,
    resolved.filePath,
  );

  return {
    attributes: {
      ...attributes,
      content: attributes.content ?? resolved.content,
      frontmatter: attributes.frontmatter ?? resolved.frontmatter,
      tags: attributes.tags ?? resolved.tags,
      filePath,
    },
    generatedFilePath: resolved.filePath,
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function validateSourceOwnership(
  db: ReturnType<typeof getDb>,
  sourceId: string,
  userId: string,
): Promise<void> {
  if (!UUID_PATTERN.test(sourceId)) {
    throw invalidAttribute(
      "SourceId must be a valid UUID",
      "/data/attributes/sourceId",
    );
  }

  const [matchedSource] = await db
    .select({ uuid: sources.uuid })
    .from(sources)
    .where(and(eq(sources.uuid, sourceId), eq(sources.userId, userId)));

  if (!matchedSource) {
    throw invalidAttribute(
      "Source not found or does not belong to you",
      "/data/attributes/sourceId",
    );
  }
}

function buildInsertValues(
  userId: string,
  attributes: Required<Pick<CreateRecordAttributes, "title" | "content">> &
    Omit<CreateRecordAttributes, "title" | "content">,
): InsertRecordValues {
  const values: InsertRecordValues = {
    userId,
    title: attributes.title,
    content: attributes.content,
  };

  for (const key of SCALAR_OPTIONAL_KEYS) {
    const value = (attributes as Record<ScalarOptionalKey, unknown>)[key];

    if (isAbsent(value)) {
      continue;
    }

    (values as Record<string, unknown>)[key] = value;
  }

  if (attributes.syncedAt !== undefined) {
    values.syncedAt = parseSyncedAt(attributes.syncedAt);
  }

  return values;
}

async function insertRecord(
  db: ReturnType<typeof getDb>,
  insertValues: InsertRecordValues,
) {
  const [created] = await db.insert(records).values(insertValues).returning();

  return created;
}

type PersistRecordOptions = {
  clientSuppliedFilePath: boolean;
  // Un-suffixed base for re-resolution on a generated-path retry (see
  // MarkdownPipelineResult.generatedFilePath).
  desiredFilePath: string | null | undefined;
};

// A client-supplied filePath (import flow) is deliberately never auto-suffixed
// (see resolveGeneratedFilePath): the client asserts the record lives at exactly
// that path, so silently rewriting it to `path-2.md` would point the record at a
// file the client never named — that collision is a 409. A server-generated path
// is auto-suffixed and retried, but if the retry budget is exhausted its 23505
// also surfaces as the same 409 rather than a raw 500. Kept out of the handler so
// its branching does not inflate the request flow's complexity.
async function persistRecord(
  db: ReturnType<typeof getDb>,
  userId: string,
  insertValues: InsertRecordValues,
  options: PersistRecordOptions,
) {
  try {
    if (options.clientSuppliedFilePath) {
      return await insertRecord(db, insertValues);
    }

    return await insertRecordWithUniqueFilePath(
      userId,
      insertValues.filePath,
      (filePath) => insertRecord(db, { ...insertValues, filePath }),
      options.desiredFilePath,
    );
  } catch (error) {
    if (isFilePathUniqueViolation(error)) {
      throw filePathConflictError();
    }

    throw error;
  }
}

type CreatedRecord = {
  uuid: string;
  status: string;
  title: string | null;
  errorMessage: string | null;
  sourceId: string | null;
};

// Best-effort activity-log entry for a freshly-created record; its own failure
// is logged and swallowed so it never rolls back the 201. Extracted so the
// status→message branching lives out of the request handler.
async function writeRecordCreatedEvent(
  userId: string,
  record: CreatedRecord,
): Promise<void> {
  const isError = record.status === "error";
  const message = isError
    ? `Record created with error: ${record.errorMessage ?? "unknown"}`
    : `Record created: ${record.title ?? "untitled"}`;

  await writeEvent({
    userId,
    kind: isError ? "err" : "ok",
    message,
    recordUuid: record.uuid,
    sourceId: record.sourceId ?? null,
  }).catch((writeError) => {
    console.error("[records/create] failed to write event:", writeError);
  });
}

export default defineEventHandler(async (event): Promise<RecordApiResponse> => {
  try {
    const userId = requireUser(event);
    const body = (await readBody(event)) as CreateRecordBody;

    apiValidate(body as ApiRequest, VALIDATION_RULES);

    const rawAttributes = body.data!.attributes as CreateRecordAttributes;

    // Ensure at least one of content or html is present before hitting the DB.
    validateContentOrHtml(rawAttributes);

    // Run synchronous shape checks before any DB queries to avoid wasted round-trips.
    validateTagsShape(rawAttributes.tags);
    validateFrontmatterShape(rawAttributes.frontmatter);

    const db = getDb();

    // Apply markdown pipeline when html is present; this may fetch user settings.
    const pipeline = await applyMarkdownPipeline(rawAttributes, db, userId);
    const attributes = pipeline.attributes as Required<
      Pick<CreateRecordAttributes, "title" | "content">
    > &
      Omit<CreateRecordAttributes, "title" | "content">;

    if (attributes.sourceId) {
      await validateSourceOwnership(db, attributes.sourceId, userId);
    }

    await assertWithinRecordLimit(userId);

    const insertValues = buildInsertValues(userId, attributes);

    // Only a server-generated path may be auto-suffixed on a concurrent-insert
    // collision; a client-supplied one 409s instead (see persistRecord).
    const clientSuppliedFilePath =
      rawAttributes.filePath !== undefined && rawAttributes.filePath !== null;

    const record = await persistRecord(db, userId, insertValues, {
      clientSuppliedFilePath,
      desiredFilePath: pipeline.generatedFilePath ?? insertValues.filePath,
    });

    await writeRecordCreatedEvent(userId, record);

    setResponseStatus(event, 201);

    return { data: recordSerializer(record) };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
