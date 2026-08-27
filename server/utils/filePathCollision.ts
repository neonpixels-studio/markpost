import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { records } from "../db/schema";

// Webhook/email records derive filePath from date+slug+source only, so two
// ingests that collapse to the same "{{date}}-{{slug}}.md" map to one file and
// the CLI sync silently overwrites one record's file with another. We give each
// colliding record a distinct path by appending a numeric suffix before the
// extension: the first record keeps the clean name, the next becomes
// "…-2.md", then "…-3.md", and so on. Non-colliding records are untouched.
//
// Comparisons are case-insensitive because the CLI writes to case-insensitive
// filesystems (macOS and Windows defaults), where "Acme/x.md" and "acme/x.md"
// are the same file even though Postgres and a plain Set treat them as distinct.

const COLLISION_SUFFIX_START = 2;

function splitExtension(filename: string): {
  base: string;
  extension: string;
} {
  const dotIndex = filename.lastIndexOf(".");
  // A leading-dot name (".keep") or a name with no dot has no extension to
  // preserve, so the whole thing is the base.
  if (dotIndex <= 0) {
    return { base: filename, extension: "" };
  }

  return {
    base: filename.slice(0, dotIndex),
    extension: filename.slice(dotIndex),
  };
}

function splitDirectory(filePath: string): {
  directory: string;
  filename: string;
} {
  const slashIndex = filePath.lastIndexOf("/");
  if (slashIndex === -1) {
    return { directory: "", filename: filePath };
  }

  return {
    directory: filePath.slice(0, slashIndex + 1),
    filename: filePath.slice(slashIndex + 1),
  };
}

function withSuffix(filePath: string, suffix: number): string {
  const { directory, filename } = splitDirectory(filePath);
  const { base, extension } = splitExtension(filename);
  return `${directory}${base}-${suffix}${extension}`;
}

export function resolveUniqueFilePath(
  desiredPath: string,
  takenPaths: Set<string>,
): string {
  const takenLower = new Set([...takenPaths].map((path) => path.toLowerCase()));

  if (!takenLower.has(desiredPath.toLowerCase())) {
    return desiredPath;
  }

  let suffix = COLLISION_SUFFIX_START;
  let candidate = withSuffix(desiredPath, suffix);

  while (takenLower.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = withSuffix(desiredPath, suffix);
  }

  return candidate;
}

// Prefix pattern matching the desired name and every numbered variant of it
// ("2026-01-01-hello.md" and "2026-01-01-hello-2.md"). The user-editable
// filenameTemplate can leave LIKE metacharacters in the path, so `\`, `%` and
// `_` are escaped (Postgres LIKE treats `\` as the default escape character,
// so no explicit ESCAPE clause is needed). An unrelated row that still slips
// into the taken set is harmless: it never equals a generated candidate.
function collisionPrefixPattern(desiredPath: string): string {
  const { directory, filename } = splitDirectory(desiredPath);
  const { base } = splitExtension(filename);
  const escaped = `${directory}${base}`.replace(/[\\%_]/g, "\\$&");
  return `${escaped}%`;
}

async function fetchTakenFilePaths(
  userId: string,
  desiredPath: string,
): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ filePath: records.filePath })
    .from(records)
    .where(
      and(
        eq(records.userId, userId),
        // Case-insensitive prefix match via lower(file_path) LIKE lower(prefix)
        // so it can use the functional records_user_id_file_path_lower_unique
        // (text_pattern_ops) index added in migration 0022; a plain ILIKE
        // cannot. The `IS NOT NULL AND <> ''` clauses are redundant for
        // correctness (a NULL lower() never matches, and a non-empty prefix
        // pattern can't match an empty path) but let the planner prove the
        // index's partial predicate (`file_path IS NOT NULL AND file_path <>
        // ''`) and actually use it. Both sides are lowered, so the comparison
        // stays case-insensitive.
        sql`${records.filePath} IS NOT NULL AND ${records.filePath} <> '' AND lower(${records.filePath}) LIKE lower(${collisionPrefixPattern(desiredPath)})`,
      ),
    );

  const takenPaths = new Set<string>();
  for (const row of rows) {
    if (row.filePath !== null) {
      takenPaths.add(row.filePath);
    }
  }

  return takenPaths;
}

// Returns desiredPath unchanged when no record for this user already owns it,
// otherwise the first free numbered variant. Isolated from the pure resolver
// above so the suffixing logic is testable without a database.
export async function ensureUniqueFilePath(
  userId: string,
  desiredPath: string,
): Promise<string> {
  // An empty path can never collide and would degrade the lookup to `ILIKE '%'`,
  // pulling every one of the user's paths into memory. Nothing to disambiguate.
  if (!desiredPath.trim()) {
    return desiredPath;
  }

  const takenPaths = await fetchTakenFilePaths(userId, desiredPath);
  return resolveUniqueFilePath(desiredPath, takenPaths);
}

// Postgres SQLSTATE for a unique_violation. Raised when an insert collides with
// the records_user_id_file_path_lower_unique index (migration 0022).
const UNIQUE_VIOLATION_CODE = "23505";
export const FILE_PATH_UNIQUE_INDEX = "records_user_id_file_path_lower_unique";

// One extra attempt beyond the initial insert per contending writer; even a
// small burst of concurrent ingests for the same path resolves in a couple of
// rounds, and a bounded ceiling keeps a genuinely stuck insert from looping
// forever instead of failing loud.
export const MAX_FILE_PATH_INSERT_ATTEMPTS = 5;

type PostgresError = {
  code?: string;
  constraint?: string;
  cause?: unknown;
};

// The neon-http driver throws a NeonDbError carrying the Postgres SQLSTATE and
// constraint name; drizzle re-throws it, and some layers wrap it under `cause`
// (behind an outer error that may carry its own unrelated `code`). So we walk
// the whole `cause` chain looking for the file_path unique violation rather than
// stopping at the first object that merely has a `code`. Bounded depth so a
// self-referential `cause` chain can't blow the stack.
const MAX_CAUSE_DEPTH = 5;

// True only for a unique violation on the file_path index — the one collision we
// can resolve by re-suffixing. Any other 23505 (or error) must propagate.
export function isFilePathUniqueViolation(error: unknown, depth = 0): boolean {
  if (depth > MAX_CAUSE_DEPTH) {
    return false;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as PostgresError;

  if (
    candidate.code === UNIQUE_VIOLATION_CODE &&
    candidate.constraint === FILE_PATH_UNIQUE_INDEX
  ) {
    return true;
  }

  return isFilePathUniqueViolation(candidate.cause, depth + 1);
}

type FilePath = string | null | undefined;

// Resolve the next path to try after a file_path unique violation, or throw to
// stop retrying. Re-resolution always works from the caller's ORIGINAL desired
// path, never the last suffixed attempt: `resolveUniqueFilePath` walks suffixes
// upward from the base's own collision prefix, so resolving from "hello.md" gives
// "hello-2", "hello-3", …, whereas resolving from "hello-2.md" narrows the prefix
// and would cascade "hello-2-2". Throws the original violation — not a resolver
// error — when the error is not ours, the attempt budget is spent, or the
// resolver cannot free a new path.
async function nextFilePathAfterViolation<Path extends FilePath>(
  userId: string,
  error: unknown,
  desiredFilePath: Path,
  failedFilePath: Path,
  attempt: number,
): Promise<Path> {
  if (!isFilePathUniqueViolation(error)) {
    throw error;
  }

  if (attempt >= MAX_FILE_PATH_INSERT_ATTEMPTS - 1) {
    throw error;
  }

  // Only a non-empty path can be in the partial unique index, so a violation
  // guarantees the desired path is a real string to re-resolve.
  const nextFilePath = (await ensureUniqueFilePath(
    userId,
    desiredFilePath as string,
  )) as Path;

  // The resolver could not free a path different from the one that just failed
  // (e.g. the winning row is somehow still invisible): retrying can only lose
  // again, so fail loud now instead of burning the budget on doomed inserts. In
  // practice the just-committed row is visible and the resolved path differs.
  if (
    String(nextFilePath).toLowerCase() === String(failedFilePath).toLowerCase()
  ) {
    throw error;
  }

  return nextFilePath;
}

// Insert a record whose file_path is guarded by the unique index, retrying on a
// concurrent-insert collision. The pre-insert suffix lookup cannot see a row a
// competing request has not committed yet (a TOCTOU race); it surfaces as a 23505
// on insert. On that violation we re-resolve a free path and retry, rather than
// 500ing. `insert` receives the path to use and must apply it to its own insert
// values. `desiredFilePath` is the caller's ORIGINAL (un-suffixed) path used as
// the re-resolution base — pass it when `initialFilePath` was already suffixed
// (a request-time collision) so retries walk "hello-2, hello-3" off the true stem
// instead of nesting "hello-2-2"; it defaults to `initialFilePath`. The generic
// `Path` keeps the caller's own nullability (a webhook always has a string; a
// client create may pass null/undefined) flowing through unchanged.
export async function insertRecordWithUniqueFilePath<
  Row,
  Path extends FilePath,
>(
  userId: string,
  initialFilePath: Path,
  insert: (filePath: Path) => Promise<Row>,
  desiredFilePath: Path = initialFilePath,
): Promise<Row> {
  let filePath = initialFilePath;

  for (let attempt = 0; attempt < MAX_FILE_PATH_INSERT_ATTEMPTS; attempt += 1) {
    try {
      return await insert(filePath);
    } catch (error) {
      filePath = await nextFilePathAfterViolation(
        userId,
        error,
        desiredFilePath,
        filePath,
        attempt,
      );
    }
  }

  // The loop returns on success or throws via nextFilePathAfterViolation; this is
  // unreachable and only present to satisfy the type checker.
  throw new Error("insertRecordWithUniqueFilePath: exhausted attempts");
}
