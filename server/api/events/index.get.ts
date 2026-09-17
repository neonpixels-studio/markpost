import { and, count, desc, eq, lt, or, type SQL } from "drizzle-orm";
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

type EventFilters = {
  kind?: EventKind;
  sourceId?: string;
};

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

// 400 (not 422) because this validates a query parameter, not a body
// attribute — matching the "Invalid cursor" 400 above and the filter[source]
// 400 in server/api/records/index.get.ts.
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
        detail: "filter[source] must be a valid source id",
        source: { parameter: "filter[source]" },
      },
    ],
    400,
  );
}

// h3's getQuery() returns a string[] when a query key is repeated (e.g.
// ?filter[kind]=err&filter[kind]=warn). Take the first value, the same
// "duplicate key" convention most query-string parsers use — mirrors
// firstQueryValue in server/api/records/index.get.ts.
function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validateKindFilter(
  rawFilterKind: string | string[] | undefined,
): EventKind | undefined {
  const filterKind = firstQueryValue(rawFilterKind);

  if (!filterKind) {
    return undefined;
  }

  if (!(EVENT_KINDS as readonly string[]).includes(filterKind)) {
    throw invalidKindFilterError();
  }

  return filterKind as EventKind;
}

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

// Row-wise keyset comparison expressed as OR(ts<c, AND(ts=c, id<c)) — the same
// form buildCursorFilter used before filters were added, kept so the query
// still seeks on events_user_id_ts_idx rather than re-scanning deep pages.
function cursorCondition(cursor: CursorPosition): SQL | undefined {
  return or(
    lt(events.ts, cursor.ts),
    and(eq(events.ts, cursor.ts), lt(events.id, cursor.id)),
  );
}

function buildFilterConditions(
  userId: string,
  cursor: CursorPosition | null,
  filters: EventFilters,
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [eq(events.userId, userId)];

  if (filters.kind) {
    conditions.push(eq(events.kind, filters.kind));
  }

  if (filters.sourceId) {
    conditions.push(eq(events.sourceId, filters.sourceId));
  }

  if (cursor) {
    conditions.push(cursorCondition(cursor));
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
