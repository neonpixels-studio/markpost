import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { events } from "../../db/schema";
import { requireScope, requireUser } from "../../utils/auth";
import { apiErrorHandler } from "../../utils/errors";
import {
  ACTIVITY_EXPORT_FILENAME,
  EXPORT_ROW_LIMIT,
  EXPORT_TRUNCATED_HEADER,
} from "#shared/utils/export";

type ExportRow = {
  id: string;
  ts: string;
  kind: string;
  message: string;
  recordUuid: string | null;
  sourceId: string | null;
};

function serializeExportRow(
  row: Omit<ExportRow, "ts"> & { ts: Date },
): ExportRow {
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    kind: row.kind,
    message: row.message,
    recordUuid: row.recordUuid,
    sourceId: row.sourceId,
  };
}

export default defineEventHandler(async (event) => {
  try {
    const userId = requireUser(event);
    requireScope(event, "events:read");
    const db = getDb();

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.userId, userId))
      .orderBy(desc(events.ts), desc(events.id))
      .limit(EXPORT_ROW_LIMIT + 1);

    const isTruncated = rows.length > EXPORT_ROW_LIMIT;
    const visibleRows = isTruncated ? rows.slice(0, EXPORT_ROW_LIMIT) : rows;
    const exportRows = visibleRows.map(serializeExportRow);

    setHeader(event, "Content-Type", "application/json");
    setHeader(
      event,
      "Content-Disposition",
      `attachment; filename="${ACTIVITY_EXPORT_FILENAME}"`,
    );
    // A full dump of the user's private activity; keep it out of shared
    // browser/proxy caches so it isn't recoverable after logout.
    setHeader(event, "Cache-Control", "no-store, private");
    setHeader(event, EXPORT_TRUNCATED_HEADER, String(isTruncated));

    return exportRows;
  } catch (error) {
    return apiErrorHandler(error);
  }
});
