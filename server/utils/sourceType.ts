import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "../db";
import { sources } from "../db/schema";

type Database = ReturnType<typeof getDb>;

// The read endpoints (list/show) resolve `sourceType` by joining `sources`
// directly into their SELECT. The write endpoints (create/patch/bulk-patch)
// only have an `insert`/`update` `.returning()` — a plain records row with no
// join — so they use this follow-up lookup instead. Scoped to the owning user
// so a record can never surface another tenant's source type.
export async function resolveSourceTypes(
  db: Database,
  userId: string,
  sourceIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const uniqueSourceIds = [
    ...new Set(
      sourceIds.filter((sourceId): sourceId is string => Boolean(sourceId)),
    ),
  ];

  if (uniqueSourceIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({ uuid: sources.uuid, type: sources.type })
    .from(sources)
    .where(
      and(eq(sources.userId, userId), inArray(sources.uuid, uniqueSourceIds)),
    );

  return new Map(rows.map((row) => [row.uuid, row.type]));
}

// Attaches the resolved sourceType (or null when the record has no source, or
// its source wasn't found in the map) to a plain records row, in the shape
// recordSerializer expects.
export function withSourceType<T extends { sourceId: string | null }>(
  record: T,
  sourceTypeMap: Map<string, string>,
): T & { sourceType: string | null } {
  return {
    ...record,
    sourceType: record.sourceId
      ? (sourceTypeMap.get(record.sourceId) ?? null)
      : null,
  };
}
