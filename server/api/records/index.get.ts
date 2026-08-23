import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  SQL,
} from "drizzle-orm";
import { getDb } from "../../db";
import { records, RECORD_STATUSES, sources } from "../../db/schema";
import { ApiError, apiErrorHandler } from "../../utils/errors";
import { buildRecordListResponse, parsePageSize } from "../../utils/pagination";
import type { RecordListApiResponse } from "../../utils/response";
import {
  isSourceType,
  SOURCE_TYPES,
  type SourceType,
} from "#shared/utils/sourceTypes";

type Database = ReturnType<typeof getDb>;

type CursorPosition = {
  createdAt: Date;
  uuid: string;
};

type RecordFilters = {
  source?: SourceType;
  status?: string;
  query?: string;
};

// Escapes the wildcard characters `%`, `_`, and `\` so user-supplied search
// text is matched literally rather than as a LIKE/ILIKE pattern.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function findCursorPosition(
  db: Database,
  userId: string,
  afterUuid: string,
): Promise<CursorPosition | null> {
  const [cursorRecord] = await db
    .select({ createdAt: records.createdAt, uuid: records.uuid })
    .from(records)
    .where(and(eq(records.userId, userId), eq(records.uuid, afterUuid)))
    .limit(1);

  return cursorRecord ?? null;
}

async function resolveCursor(
  db: Database,
  userId: string,
  afterUuid: string | undefined,
): Promise<CursorPosition | null> {
  if (!afterUuid) {
    return null;
  }

  const cursor = await findCursorPosition(db, userId, afterUuid);
  if (!cursor) {
    throw new ApiError(
      [
        {
          status: "400",
          title: "Invalid cursor",
          detail: `Record '${afterUuid}' not found or not accessible`,
        },
      ],
      400,
    );
  }

  return cursor;
}

// 400 (not 422) because this validates a query parameter, not a body
// attribute — matching the "Invalid cursor" 400 above rather than the 422s
// used for POST /api/sources body validation.
function invalidSourceFilterError(): ApiError {
  return new ApiError(
    [
      {
        status: "400",
        title: "Invalid filter[source]",
        detail: `filter[source] must be one of: ${SOURCE_TYPES.join(", ")}`,
        source: { parameter: "filter[source]" },
      },
    ],
    400,
  );
}

// h3's getQuery() returns a string[] when a query key is repeated (e.g.
// ?filter[source]=webhook&filter[source]=email). filter[status] and
// filter[q] silently ignore that shape today (same as any other unrecognized
// value), but filter[source] now throws on an unrecognized value, so an
// unnormalized array would produce a misleading "must be one of" error even
// though every value the caller sent was valid. Take the first value, the
// same "duplicate key" convention most query-string parsers use.
function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validateSourceFilter(
  rawFilterSource: string | string[] | undefined,
): SourceType | undefined {
  const filterSource = firstQueryValue(rawFilterSource);

  if (!filterSource) {
    return undefined;
  }

  if (!isSourceType(filterSource)) {
    throw invalidSourceFilterError();
  }

  return filterSource;
}

// Type filtering keys off the source a record was ingested from, not the
// free-text `records.source` display name (which stores the source's name,
// e.g. "My Zapier hook", never a "webhook/…" prefix). We match records whose
// `sourceId` points to a source of the requested `type`, scoping the subquery
// to the same user so it is self-contained. A record with a NULL `sourceId`
// (e.g. created directly via the records API without a source) matches no
// type, which is correct.
export function sourceTypeCondition(
  db: Database,
  userId: string,
  sourceType: SourceType,
): SQL {
  const matchingSourceIds = db
    .select({ uuid: sources.uuid })
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.type, sourceType)));

  return inArray(records.sourceId, matchingSourceIds);
}

// Row-wise (a.k.a. tuple) keyset comparison instead of the equivalent
// `OR(created_at < c, AND(created_at = c, uuid < u))`. Postgres treats a row
// comparison as a single range predicate, so it can seek straight to the
// cursor's position in records_user_id_created_at_idx (user_id, created_at
// desc, uuid desc) rather than re-walking the page from the top on every deep
// page. The column and value order must mirror that index's sort order.
export function recordCursorCondition(cursor: CursorPosition): SQL {
  return sql`(${records.createdAt}, ${records.uuid}) < (${cursor.createdAt}, ${cursor.uuid})`;
}

function buildFilterConditions(
  db: Database,
  userId: string,
  cursor: CursorPosition | null,
  filters: RecordFilters,
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [eq(records.userId, userId)];

  if (filters.source) {
    conditions.push(sourceTypeCondition(db, userId, filters.source));
  }

  if (filters.status) {
    conditions.push(eq(records.status, filters.status));
  }

  if (filters.query) {
    const pattern = `%${escapeLikePattern(filters.query)}%`;
    conditions.push(
      or(ilike(records.title, pattern), ilike(records.content, pattern)),
    );
  }

  if (cursor) {
    conditions.push(recordCursorCondition(cursor));
  }

  return and(...conditions);
}

async function countFilteredRecords(
  db: Database,
  userId: string,
  filters: RecordFilters,
): Promise<number> {
  const [totalRow] = await db
    .select({ value: count() })
    .from(records)
    .where(buildFilterConditions(db, userId, null, filters));

  return totalRow?.value ?? 0;
}

function fetchRecordsPage(
  db: Database,
  userId: string,
  cursor: CursorPosition | null,
  size: number,
  filters: RecordFilters,
) {
  return db
    .select()
    .from(records)
    .where(buildFilterConditions(db, userId, cursor, filters))
    .orderBy(desc(records.createdAt), desc(records.uuid))
    .limit(size + 1);
}

export default defineEventHandler(
  async (event): Promise<RecordListApiResponse> => {
    try {
      const userId = requireUser(event);
      const db = getDb();

      const query = getQuery(event);
      const size = parsePageSize(query["page[size]"] as string | undefined);
      const afterUuid = query["page[after]"] as string | undefined;
      const filterSource = query["filter[source]"] as
        string | string[] | undefined;
      const filterStatus = query["filter[status]"] as string | undefined;
      const filterQuery = query["filter[q]"] as string | undefined;

      const validatedSource = validateSourceFilter(filterSource);

      const validatedStatus = RECORD_STATUSES.includes(
        filterStatus as (typeof RECORD_STATUSES)[number],
      )
        ? filterStatus
        : undefined;

      const trimmedQuery = filterQuery?.trim();

      const filters: RecordFilters = {
        source: validatedSource,
        status: validatedStatus,
        query: trimmedQuery ? trimmedQuery : undefined,
      };

      const cursor = await resolveCursor(db, userId, afterUuid);
      const total = await countFilteredRecords(db, userId, filters);
      const pageRecords = await fetchRecordsPage(
        db,
        userId,
        cursor,
        size,
        filters,
      );

      return buildRecordListResponse({
        records: pageRecords,
        size,
        total,
        prevCursor: afterUuid ?? null,
      });
    } catch (error) {
      return apiErrorHandler(error);
    }
  },
);
