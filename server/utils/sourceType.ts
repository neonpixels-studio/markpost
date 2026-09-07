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

  // sourceType is a display-only enrichment on a create/update that has
  // already succeeded (record inserted/updated, event written). A failure
  // here must degrade to "unknown type" rather than turn an already-successful
  // write into an error response — or worse, an error body under a 201/200
  // status that was set before this ran.
  try {
    const rows = await db
      .select({ uuid: sources.uuid, type: sources.type })
      .from(sources)
      .where(
        and(eq(sources.userId, userId), inArray(sources.uuid, uniqueSourceIds)),
      );

    return new Map(rows.map((row) => [row.uuid, row.type]));
  } catch (error) {
    console.error("[sourceType] failed to resolve source types", {
      userId,
      sourceIds: uniqueSourceIds,
      error,
    });
    return new Map();
  }
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
