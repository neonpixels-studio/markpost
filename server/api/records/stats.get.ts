import { count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { records, RECORD_STATUSES } from "../../db/schema";
import { requireScope, requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";
import {
  resolveTimeZone,
  startOfMonthIso,
  startOfTodayIso,
} from "../../utils/statsBoundaries";

// Query key the client sends its IANA time zone under (e.g. "America/New_York")
// so day/month boundaries roll over at the user's local midnight.
const TIME_ZONE_QUERY_KEY = "tz";

type RecordStats = {
  syncedToday: number;
  pending: number;
  errors: number;
  thisMonth: number;
};

type StatsApiResponse = {
  data: RecordStats;
};

const [STATUS_SYNCED, STATUS_PENDING, STATUS_ERROR] = RECORD_STATUSES;

function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function fetchRecordStats(
  db: ReturnType<typeof getDb>,
  userId: string,
  timeZone: string,
): Promise<RecordStats> {
  const todayStartIso = startOfTodayIso(timeZone);
  const monthStartIso = startOfMonthIso(timeZone);

  const rows = await db
    .select({
      // syncedAt alone isn't enough: a record synced earlier today and since
      // moved to pending/error (see server/api/records/index.patch.ts) keeps
      // its real syncedAt, so the status check here is what keeps this card
      // reporting records that are *currently* synced, not just ones that
      // were at some point today.
      syncedToday: count(
        sql`CASE WHEN ${eq(records.status, STATUS_SYNCED)} AND ${isNotNull(records.syncedAt)} AND ${gte(records.syncedAt, todayStartIso)} THEN 1 END`,
      ),
      pending: count(
        sql`CASE WHEN ${records.status} = ${STATUS_PENDING} THEN 1 END`,
      ),
      errors: count(
        sql`CASE WHEN ${records.status} = ${STATUS_ERROR} THEN 1 END`,
      ),
      thisMonth: count(
        sql`CASE WHEN ${gte(records.createdAt, monthStartIso)} THEN 1 END`,
      ),
    })
    .from(records)
    .where(eq(records.userId, userId));

  const row = rows[0];

  return {
    syncedToday: Number(row?.syncedToday ?? 0),
    pending: Number(row?.pending ?? 0),
    errors: Number(row?.errors ?? 0),
    thisMonth: Number(row?.thisMonth ?? 0),
  };
}

export default defineEventHandler(async (event): Promise<StatsApiResponse> => {
  try {
    const userId = requireUser(event);
    requireScope(event, "records:read");
    const db = getDb();
    const query = getQuery(event);
    const timeZone = resolveTimeZone(
      firstQueryValue(
        query[TIME_ZONE_QUERY_KEY] as string | string[] | undefined,
      ),
    );
    const fetchedStats = await fetchRecordStats(db, userId, timeZone);
    return { data: fetchedStats };
  } catch (error) {
    return apiErrorHandler(error);
  }
});
