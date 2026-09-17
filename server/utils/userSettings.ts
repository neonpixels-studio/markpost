import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { userSettings } from "../db/schema";

// Mirrors the fallback already inlined at two existing call sites
// (server/api/records/index.post.ts and server/api/hooks/[slug].post.ts).
// @todo Point those two at this shared helper and delete their own copies —
// left alone here because both files were off-limits when this was written
// (concurrent unmerged work landing in server/api/hooks/[slug].post.ts, and
// records/index.post.ts being out of scope for the change that added this
// file). New callers (like the source test-event endpoint) should read
// through this helper rather than adding a fourth inline copy.
const DEFAULT_FILENAME_TEMPLATE = "{{date}}-{{slug}}.md";

export async function fetchFilenameTemplate(userId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ filenameTemplate: userSettings.filenameTemplate })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  return row?.filenameTemplate ?? DEFAULT_FILENAME_TEMPLATE;
}
