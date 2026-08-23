import type { ApiResourceObject, ApiResponse } from "../types/api.types";

export const CONFLICT_STRATEGIES = ["suffix", "overwrite", "skip"] as const;
export type ConflictStrategy = (typeof CONFLICT_STRATEGIES)[number];

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

type ApiResponseMeta = NonNullable<ApiResponse["meta"]>;
type ApiResponseLinks = NonNullable<ApiResponse["links"]>;

type RecordAttributes = {
  uuid: string;
  createdAt: Date;
  userId: string;
  title: string;
  content: string;
  sourceId: string | null;
  source: string | null;
  // The canonical source type (`sources.type`), resolved by joining
  // `records.sourceId → sources.uuid`. Distinct from `source`, which stores the
  // free-text display name. Null when a record has no source (direct API create)
  // or is returned by an endpoint that does not join sources (create/patch);
  // the list and detail GET endpoints populate the real value.
  sourceType: string | null;
  status: string;
  filePath: string | null;
  tags: unknown;
  frontmatter: unknown;
  syncedAt: Date | null;
  errorMessage: string | null;
};

// Callers that do not join sources (create/patch/hooks) pass a plain record row
// without `sourceType`; the serializer defaults it to null for them.
type RecordInput = Omit<RecordAttributes, "sourceType"> & {
  sourceType?: string | null;
};

type RecordResource = ApiResourceObject & {
  type: "records";
  attributes: RecordAttributes;
  links: { self: string };
};

type PaginationMetaOptions = {
  total: number;
  size: number;
  hasMore: boolean;
};

type PaginationMeta = ApiResponseMeta & PaginationMetaOptions;

type PaginationLinksOptions = {
  afterCursor: string | null;
  prevCursor: string | null;
  size: number;
  hasMore: boolean;
};

type PaginationLinks = ApiResponseLinks & {
  next: string | null;
  prev: string | null;
};

type UserSettingsAttributes = {
  userId: string;
  vaultDir: string;
  filenameTemplate: string;
  autoSync: boolean;
  autoDelete: boolean;
  frontmatter: boolean;
  conflictStrategy: string;
  theme: string;
  accentColor: string;
  updatedAt: Date;
};

type UserSettingsInput = UserSettingsAttributes;

type UserSettingsResource = ApiResourceObject & {
  type: "user_settings";
  attributes: UserSettingsAttributes;
  links: { self: string };
};

export type UserSettingsApiResponse = ApiResponse<UserSettingsResource>;

export function userSettingsSerializer(
  settings: UserSettingsInput,
): UserSettingsResource {
  return {
    type: "user_settings",
    id: settings.userId,
    attributes: {
      userId: settings.userId,
      vaultDir: settings.vaultDir,
      filenameTemplate: settings.filenameTemplate,
      autoSync: settings.autoSync,
      autoDelete: settings.autoDelete,
      frontmatter: settings.frontmatter,
      conflictStrategy: settings.conflictStrategy,
      theme: settings.theme,
      accentColor: settings.accentColor,
      updatedAt: settings.updatedAt,
    },
    links: {
      self: "/api/settings",
    },
  };
}

export type RecordApiResponse = ApiResponse<RecordResource | null>;
export type RecordListApiResponse = ApiResponse<RecordResource[]>;

export function recordSerializer(
  record: RecordInput | null | undefined,
): RecordResource | null {
  if (!record) {
    return null;
  }

  return {
    type: "records",
    id: record.uuid,
    attributes: {
      uuid: record.uuid,
      createdAt: record.createdAt,
      userId: record.userId,
      title: record.title,
      content: record.content,
      sourceId: record.sourceId,
      source: record.source,
      sourceType: record.sourceType ?? null,
      status: record.status,
      filePath: record.filePath,
      tags: record.tags,
      frontmatter: record.frontmatter,
      syncedAt: record.syncedAt,
      errorMessage: record.errorMessage,
    },
    links: {
      self: `/api/records/${record.uuid}`,
    },
  };
}

export function paginationMeta(options: PaginationMetaOptions): PaginationMeta {
  return {
    total: options.total,
    size: options.size,
    hasMore: options.hasMore,
  };
}

export function paginationLinks(
  options: PaginationLinksOptions,
): PaginationLinks {
  const nextLink = buildNextLink(options);
  const prevLink = buildPrevLink(options);

  return {
    next: nextLink,
    prev: prevLink,
  };
}

function buildNextLink(options: PaginationLinksOptions): string | null {
  if (!options.hasMore || !options.afterCursor) {
    return null;
  }

  const params = new URLSearchParams({
    "page[after]": options.afterCursor,
    "page[size]": String(options.size),
  });

  return `/api/records?${params.toString()}`;
}

function buildPrevLink(options: PaginationLinksOptions): string | null {
  if (!options.prevCursor) {
    return null;
  }

  const params = new URLSearchParams({
    "page[after]": options.prevCursor,
    "page[size]": String(options.size),
  });

  return `/api/records?${params.toString()}`;
}

type SourceAttributes = {
  uuid: string;
  userId: string;
  createdAt: Date;
  type: string;
  name: string;
  provider: string | null;
  providerSecret?: string | null;
  endpointSlug: string;
  routeFolder: string;
  fieldMapping: unknown;
  lastHitAt: Date | null;
  recordCount: number;
};

type SourceInput = SourceAttributes;

type SourceResource = ApiResourceObject & {
  type: "sources";
  attributes: SourceAttributes;
  links: { self: string };
};

export type SourceApiResponse = ApiResponse<SourceResource | null>;
export type SourceListApiResponse = ApiResponse<SourceResource[]>;

export type SourceSerializerOptions = {
  // The generated provider secret (GitHub/Zapier/Shortcuts HMAC/shared-secret
  // key) is revealed exactly once, in the response to the request that
  // created it — never on GET/list or PATCH, where it would otherwise sit in
  // every future response body, proxy log, and browser devtools capture for
  // as long as the source exists.
  revealProviderSecret?: boolean;
};

export function sourceSerializer(
  source: SourceInput | null | undefined,
  options: SourceSerializerOptions = {},
): SourceResource | null {
  if (!source) {
    return null;
  }

  return {
    type: "sources",
    id: source.uuid,
    attributes: {
      uuid: source.uuid,
      userId: source.userId,
      createdAt: source.createdAt,
      type: source.type,
      name: source.name,
      provider: source.provider,
      providerSecret: options.revealProviderSecret
        ? (source.providerSecret ?? null)
        : null,
      endpointSlug: source.endpointSlug,
      routeFolder: source.routeFolder,
      fieldMapping: source.fieldMapping,
      lastHitAt: source.lastHitAt,
      recordCount: source.recordCount,
    },
    links: {
      self: `/api/sources/${source.uuid}`,
    },
  };
}

type EventInput = {
  id: string;
  userId: string;
  ts: Date;
  kind: string;
  message: string;
  recordUuid: string | null;
  sourceId: string | null;
};

type EventAttributes = Omit<EventInput, "ts"> & { ts: string };

type EventResource = ApiResourceObject & {
  type: "events";
  attributes: EventAttributes;
  links: { self: string };
};

export type EventListApiResponse = ApiResponse<EventResource[]>;

export function eventSerializer(
  event: EventInput | null | undefined,
): EventResource | null {
  if (!event) {
    return null;
  }

  return {
    type: "events",
    id: event.id,
    attributes: {
      id: event.id,
      userId: event.userId,
      ts: event.ts.toISOString(),
      kind: event.kind,
      message: event.message,
      recordUuid: event.recordUuid,
      sourceId: event.sourceId,
    },
    links: {
      self: `/api/events/${event.id}`,
    },
  };
}

type EventPaginationLinksOptions = {
  afterCursor: string | null;
  size: number;
  hasMore: boolean;
};

type EventPaginationLinks = ApiResponseLinks & { next: string | null };

export function eventPaginationLinks(
  options: EventPaginationLinksOptions,
): EventPaginationLinks {
  return { next: buildEventNextLink(options) };
}

function buildEventNextLink(
  options: EventPaginationLinksOptions,
): string | null {
  if (!options.hasMore || !options.afterCursor) {
    return null;
  }

  const params = new URLSearchParams({
    "page[after]": options.afterCursor,
    "page[size]": String(options.size),
  });

  return `/api/events?${params.toString()}`;
}
