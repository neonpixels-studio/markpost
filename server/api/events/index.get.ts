import { and, count, desc, eq, lt, or } from "drizzle-orm";
import { getDb } from "../../db";
import { events } from "../../db/schema";
import { requireScope, requireUser } from "../../utils/auth";
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

function buildCursorFilter(userId: string, cursor: CursorPosition | null) {
  const ownerFilter = eq(events.userId, userId);

  if (!cursor) {
    return ownerFilter;
  }

  const beforeCursor = or(
    lt(events.ts, cursor.ts),
    and(eq(events.ts, cursor.ts), lt(events.id, cursor.id)),
  );

  return and(ownerFilter, beforeCursor);
}

async function countUserEvents(db: Database, userId: string): Promise<number> {
  const [totalRow] = await db
    .select({ value: count() })
    .from(events)
    .where(eq(events.userId, userId));

  return totalRow?.value ?? 0;
}

function fetchEventsPage(
  db: Database,
  userId: string,
  cursor: CursorPosition | null,
  size: number,
) {
  return db
    .select()
    .from(events)
    .where(buildCursorFilter(userId, cursor))
    .orderBy(desc(events.ts), desc(events.id))
    .limit(size + 1);
}

export default defineEventHandler(
  async (event): Promise<EventListApiResponse> => {
    try {
      const userId = requireUser(event);
      requireScope(event, "events:read");
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

      const cursor = await resolveCursor(db, userId, afterId);

      const [total, pageEvents] = await Promise.all([
        countUserEvents(db, userId),
        fetchEventsPage(db, userId, cursor, size),
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
