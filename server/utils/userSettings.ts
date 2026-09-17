import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { userSettings } from "../db/schema";

// Mirrors the fallback already inlined at the two existing call sites
// (server/api/records/index.post.ts and server/api/hooks/[slug].post.ts) —
// not consolidated here since neither of those files is safe to touch right
// now (see the source test-event endpoint's coordination notes), but new
// callers (like the test-event endpoint) should read through this shared
// helper rather than adding a fourth inline copy.
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
