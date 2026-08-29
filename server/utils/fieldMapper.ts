import type { WebhookPayload } from "./markdown";

export type FieldMappingConfig = {
  title?: string;
  content?: string;
  html?: string;
  source?: string;
  tags?: string;
  created?: string;
};

function isFieldMappingConfig(value: unknown): value is FieldMappingConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const validKeys: Array<keyof FieldMappingConfig> = [
    "title",
    "content",
    "html",
    "source",
    "tags",
    "created",
  ];

  for (const key of validKeys) {
    if (key in candidate && typeof candidate[key] !== "string") {
      return false;
    }
  }

  return true;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyTag(value: string): string | undefined {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

function splitCommaSeparatedTags(value: string): string[] {
  return value
    .split(TAG_STRING_DELIMITER)
    .map(toNonEmptyTag)
    .filter((tag): tag is string => tag !== undefined);
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

function coerceTagsValue(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    const parsed = tryParseJson(value);

    if (parsed !== undefined) {
      return coerceParsedJsonTags(parsed);
    }

    return splitCommaSeparatedTags(value);
  }

  if (Array.isArray(value)) {
    return value
      .map(coerceTagItem)
      .filter((tag): tag is string => tag !== undefined);
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
