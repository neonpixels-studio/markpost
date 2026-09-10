import type { WebhookPayload } from "./markdown";
import {
  FIELD_MAPPING_FORBIDDEN_SEGMENTS as FORBIDDEN_KEYS,
  isFieldMappingConfig,
} from "#shared/utils/fieldMapping";

function getNestedValue(
  payload: Record<string, unknown>,
  path: string,
): unknown {
  const segments = path.split(".");
  let current: unknown = payload;

  for (const segment of segments) {
    if (FORBIDDEN_KEYS.has(segment)) {
      return undefined;
    }

    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function pickStringField(
  payload: Record<string, unknown>,
  path: string | undefined,
): string | undefined {
  if (!path) {
    return undefined;
  }

  const value = getNestedValue(payload, path);

  if (typeof value !== "string") {
    return undefined;
  }

  return value;
}

const TAG_STRING_DELIMITER = ",";
const JSON_VALUE_PREFIXES = ["[", "{"] as const;
const TAG_OBJECT_KEYS = ["name", "title", "label", "value"] as const;

// A string field mapped to tags can expand an arbitrarily large comma body (or
// JSON array) into an unbounded number of tags, which flow into records.tags
// (jsonb) and a single YAML frontmatter line. These caps bound both.
export const MAX_TAGS = 50;
export const MAX_TAG_LENGTH = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateToMaxLength(value: string): string {
  // UTF-16 length is never less than the code point count, so a
  // short-enough value can never need truncating.
  if (value.length <= MAX_TAG_LENGTH) {
    return value;
  }

  // A code point is at most 2 UTF-16 units, so the first MAX_TAG_LENGTH code
  // points always live within the first MAX_TAG_LENGTH * 2 units. Slicing to
  // that bound first (rather than spreading the whole, possibly huge, value
  // into an array of code points) keeps this cheap for an oversized single
  // tag. Iterating that bounded slice by code point (via the string
  // iterator), not index, means a surrogate pair (e.g. an emoji) straddling
  // the MAX_TAG_LENGTH boundary is never split into a lone, invalid
  // surrogate. Grapheme clusters (e.g. ZWJ emoji sequences, combining marks)
  // are not preserved — a cut can still land mid-cluster; only surrogate-pair
  // validity is guaranteed. Re-trim after cutting since the cut can land on
  // an interior space the original trim() never saw.
  return Array.from(value.slice(0, MAX_TAG_LENGTH * 2))
    .slice(0, MAX_TAG_LENGTH)
    .join("")
    .trimEnd();
}

function toNonEmptyTag(value: string): string | undefined {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  return truncateToMaxLength(trimmed);
}

function readOwnStringProperty(
  item: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(item, key)) {
    return undefined;
  }

  const candidate = item[key];

  if (typeof candidate !== "string") {
    return undefined;
  }

  return toNonEmptyTag(candidate);
}

function extractTagFromObject(
  item: Record<string, unknown>,
): string | undefined {
  for (const key of TAG_OBJECT_KEYS) {
    const tag = readOwnStringProperty(item, key);

    if (tag !== undefined) {
      return tag;
    }
  }

  return undefined;
}

function coerceTagItem(item: unknown): string | undefined {
  if (typeof item === "string") {
    return toNonEmptyTag(item);
  }

  if (isPlainObject(item)) {
    return extractTagFromObject(item);
  }

  return undefined;
}

function tryParseJson(value: string): unknown | undefined {
  const trimmed = value.trim();

  if (!JSON_VALUE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function coerceParsedJsonTags(parsed: unknown): string[] {
  if (Array.isArray(parsed)) {
    return coerceTagsValue(parsed) ?? [];
  }

  const tag = coerceTagItem(parsed);

  return tag !== undefined ? [tag] : [];
}

// Stops coercing items once MAX_TAGS is reached instead of coercing every
// item and slicing after. For the array path this bounds per-item coercion
// work to the cap; for the comma-separated string path, `value.split(...)`
// still eagerly builds one segment per delimiter (the string itself is
// already bounded by MAX_WEBHOOK_BODY_BYTES at the webhook boundary — the
// only caller of coerceTagsValue is server/api/hooks/[slug].post.ts, which
// runs assertBodyWithinLimit before the body is ever parsed — so that
// allocation tops out at ~1 MiB worth of segments), but this loop still stops
// the per-segment trim/truncate work at the cap rather than running it over
// every segment.
//
// Dedupes as it collects: two distinct tags that share their first
// MAX_TAG_LENGTH characters truncate to the same string, and without dedup
// that collision would spend the MAX_TAGS budget on repeats of one value.
function collectTags(items: Iterable<unknown>): string[] {
  const tags = new Set<string>();

  for (const item of items) {
    if (tags.size >= MAX_TAGS) {
      break;
    }

    const tag = coerceTagItem(item);

    if (tag === undefined) {
      continue;
    }

    tags.add(tag);
  }

  return [...tags];
}

function coerceTagsValue(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    const parsed = tryParseJson(value);

    if (parsed !== undefined) {
      return coerceParsedJsonTags(parsed);
    }

    return collectTags(value.split(TAG_STRING_DELIMITER));
  }

  if (Array.isArray(value)) {
    return collectTags(value);
  }

  return undefined;
}

function pickTagsField(
  payload: Record<string, unknown>,
  path: string | undefined,
): string[] | undefined {
  if (!path) {
    return undefined;
  }

  return coerceTagsValue(getNestedValue(payload, path));
}

export function applyFieldMapping(
  payload: Record<string, unknown>,
  rawFieldMapping: unknown,
  sourceName: string,
): WebhookPayload {
  if (!isFieldMappingConfig(rawFieldMapping)) {
    return buildRawWebhookPayload(payload, sourceName);
  }

  return {
    title: pickStringField(payload, rawFieldMapping.title),
    content: pickStringField(payload, rawFieldMapping.content),
    html: pickStringField(payload, rawFieldMapping.html),
    source: pickStringField(payload, rawFieldMapping.source) ?? sourceName,
    tags: pickTagsField(payload, rawFieldMapping.tags),
    created: pickStringField(payload, rawFieldMapping.created),
  };
}

export function buildRawWebhookPayload(
  payload: Record<string, unknown>,
  sourceName: string,
): WebhookPayload {
  const title = typeof payload.title === "string" ? payload.title : undefined;
  const content =
    typeof payload.content === "string" ? payload.content : undefined;
  const html = typeof payload.html === "string" ? payload.html : undefined;
  const tags = coerceTagsValue(payload.tags);
  const created =
    typeof payload.created === "string" ? payload.created : undefined;

  return {
    title,
    content,
    html,
    source: sourceName,
    tags,
    created,
  };
}
