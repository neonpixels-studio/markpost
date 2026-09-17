import { and, count, desc, eq, lt, or } from "drizzle-orm";
import { getDb } from "../../db";
import { events, EVENT_KINDS, type EventKind } from "../../db/schema";
import { requireUser } from "../../utils/auth";
import { ApiError, apiErrorHandler } from "../../utils/errors";
import { parsePageSize } from "../../utils/pagination";
import {
  eventSerializer,
  eventPaginationLinks,
  paginationMeta,
  type EventListApiResponse,
} from "../../utils/response";
import { isValidUuid } from "../../utils/uuid";

type Database = ReturnType<typeof getDb>;

type CursorPosition = {
  ts: Date;
  id: string;
};

// filter[kind] narrows to a single EVENT_KINDS value; filter[source] narrows
// to events attributed to one sources.uuid (the FK events.sourceId points
// at), letting a caller debugging one failing integration skip every
// unrelated event instead of paging through the whole 90-day feed.
type EventFilters = {
  kind?: EventKind;
  sourceId?: string;
};

function isEventKind(value: string): value is EventKind {
  return (EVENT_KINDS as readonly string[]).includes(value);
}

// h3's getQuery() returns a string[] when a query key is repeated (e.g.
// ?filter[kind]=err&filter[kind]=warn). Take the first value, the same
// "duplicate key" convention GET /api/records uses for filter[source].
function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// 400 (not 422) because these validate query parameters, not body
// attributes — matching the "Invalid cursor" 400 below rather than the 422s
// used for request-body validation elsewhere in the API.
function invalidKindFilterError(): ApiError {
  return new ApiError(
    [
      {
        status: "400",
        title: "Invalid filter[kind]",
        detail: `filter[kind] must be one of: ${EVENT_KINDS.join(", ")}`,
        source: { parameter: "filter[kind]" },
      },
    ],
    400,
  );
}

function invalidSourceFilterError(): ApiError {
  return new ApiError(
    [
      {
        status: "400",
        title: "Invalid filter[source]",
        detail: "filter[source] must be a valid source uuid",
        source: { parameter: "filter[source]" },
      },
    ],
    400,
  );
}

function validateKindFilter(
  rawFilterKind: string | string[] | undefined,
): EventKind | undefined {
  const filterKind = firstQueryValue(rawFilterKind);

  if (!filterKind) {
    return undefined;
  }

  if (!isEventKind(filterKind)) {
    throw invalidKindFilterError();
  }

  return filterKind;
}

// Unlike page[after], an unrecognized-but-well-formed uuid is not an error —
// it just matches no events (the source may belong to another user or have
// since been deleted, and events.sourceId already scopes by events.userId,
// so it can't leak another tenant's data). Only a malformed value is
// rejected, the same way filter[source] on GET /api/records rejects an
// unrecognized SourceType rather than silently ignoring it.
function validateSourceFilter(
  rawFilterSource: string | string[] | undefined,
): string | undefined {
  const filterSource = firstQueryValue(rawFilterSource);

  if (!filterSource) {
    return undefined;
  }

  if (!isValidUuid(filterSource)) {
    throw invalidSourceFilterError();
  }

  return filterSource;
}

async function findCursorPosition(
  db: Database,
  userId: string,
  afterId: string,
): Promise<CursorPosition | null> {
  const [cursorEvent] = await db
    .select({ ts: events.ts, id: events.id })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.id, afterId)))
    .limit(1);

  return cursorEvent ?? null;
}

async function resolveCursor(
  db: Database,
  userId: string,
  afterId: string | undefined,
): Promise<CursorPosition | null> {
  if (!afterId) {
    return null;
  }

  const cursor = await findCursorPosition(db, userId, afterId);

  if (!cursor) {
    throw new ApiError(
      [
        {
          status: "400",
          title: "Invalid cursor",
          detail: `Event '${afterId}' not found or not accessible`,
        },
      ],
      400,
    );
  }

  return cursor;
}

function buildFilterConditions(
  userId: string,
  cursor: CursorPosition | null,
  filters: EventFilters,
) {
  const conditions = [eq(events.userId, userId)];

  if (filters.kind) {
    conditions.push(eq(events.kind, filters.kind));
  }

  if (filters.sourceId) {
    conditions.push(eq(events.sourceId, filters.sourceId));
  }

  if (cursor) {
    conditions.push(
      or(
        lt(events.ts, cursor.ts),
        and(eq(events.ts, cursor.ts), lt(events.id, cursor.id)),
      ),
    );
  }

  return and(...conditions);
}

async function countFilteredEvents(
  db: Database,
  userId: string,
  filters: EventFilters,
): Promise<number> {
  const [totalRow] = await db
    .select({ value: count() })
    .from(events)
    .where(buildFilterConditions(userId, null, filters));

  return totalRow?.value ?? 0;
}

function fetchEventsPage(
  db: Database,
  userId: string,
  cursor: CursorPosition | null,
  size: number,
  filters: EventFilters,
) {
  return db
    .select()
    .from(events)
    .where(buildFilterConditions(userId, cursor, filters))
    .orderBy(desc(events.ts), desc(events.id))
    .limit(size + 1);
}

export default defineEventHandler(
  async (event): Promise<EventListApiResponse> => {
    try {
      const userId = requireUser(event);
      const db = getDb();

      const query = getQuery(event);
      const size = parsePageSize(query["page[size]"] as string | undefined);
      const rawAfterId = query["page[after]"];
      const afterId = typeof rawAfterId === "string" ? rawAfterId : undefined;

      if (afterId !== undefined && !isValidUuid(afterId)) {
        throw new ApiError(
          [
            {
              status: "400",
              title: "Invalid cursor",
              detail: `Event '${afterId}' not found or not accessible`,
            },
          ],
          400,
        );
      }

      const filters: EventFilters = {
        kind: validateKindFilter(
          query["filter[kind]"] as string | string[] | undefined,
        ),
        sourceId: validateSourceFilter(
          query["filter[source]"] as string | string[] | undefined,
        ),
      };

      const cursor = await resolveCursor(db, userId, afterId);

      const [total, pageEvents] = await Promise.all([
        countFilteredEvents(db, userId, filters),
        fetchEventsPage(db, userId, cursor, size, filters),
      ]);

      const hasMore = pageEvents.length > size;
      const visibleEvents = hasMore ? pageEvents.slice(0, size) : pageEvents;

      const data = visibleEvents
        .map((row) => eventSerializer(row))
        .filter((resource) => resource !== null);

      const lastEvent = visibleEvents.at(-1);
      const afterCursor = lastEvent ? lastEvent.id : null;

      return {
        data,
        meta: paginationMeta({ total, size, hasMore }),
        links: eventPaginationLinks({ afterCursor, size, hasMore }),
      };
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
