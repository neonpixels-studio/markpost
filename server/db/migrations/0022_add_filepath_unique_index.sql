-- Close the file_path collision race at the database level. The app-level suffix
-- strategy (server/utils/filePathCollision.ts) reads the taken paths, then
-- inserts — a TOCTOU window where two concurrent ingests both see "hello.md"
-- free and both insert it, and a window where a client POSTs a filePath that
-- duplicates an existing one without ever passing through the suffixer. Both let
-- two records map to one synced file. A UNIQUE (user_id, lower(file_path)) index
-- makes that impossible; the insert paths catch 23505 and re-suffix.
--
-- Dedupe existing colliders FIRST, or the unique index cannot be created. Keep
-- the earliest row per (user, case-insensitive path) untouched (deterministic:
-- created_at, then uuid), and rewrite every later collider's path by inserting
-- its own uuid before the final extension. The uuid is globally unique and never
-- appears in a template-generated path, so the rewritten path collides with
-- nothing — no second pass needed. The stem is capped at 200 characters first so
-- a rewritten ASCII path (dir + 200 + "-" + 32 hex + ext) stays well under the
-- 255-byte filename limit the CLI writes to; an all-multibyte stem could still
-- exceed it, but these are rare pre-existing rows and Postgres text has no length
-- limit, so the migration itself always applies. Partial: NULL/empty paths ("no
-- file yet") are excluded, matching the partial unique index below, and never
-- collide.
WITH parts AS (
  SELECT
    "uuid",
    "user_id",
    "created_at",
    "file_path",
    regexp_match("file_path", '^(.*/)?([^/]+?)(\.[^/.]+)?$') AS path_parts
  FROM "records"
  WHERE "file_path" IS NOT NULL AND "file_path" <> ''
),
ranked AS (
  SELECT
    "uuid",
    path_parts,
    row_number() OVER (
      PARTITION BY "user_id", lower("file_path")
      ORDER BY "created_at", "uuid"
    ) AS collision_rank
  FROM parts
)
UPDATE "records" AS r
SET
  "file_path" = COALESCE(
    -- Regex matched: rebuild dir + capped stem + "-<uuid>" + ext.
    COALESCE(ranked.path_parts[1], '')
      || left(ranked.path_parts[2], 200)
      || '-'
      || replace(r."uuid"::text, '-', '')
      || COALESCE(ranked.path_parts[3], ''),
    -- Regex did not match (e.g. a path ending in "/", so no filename group): the
    -- inner expression is NULL. Fall back to the whole original path + "-<uuid>"
    -- so the row keeps its path and never gets silently wiped to NULL.
    r."file_path" || '-' || replace(r."uuid"::text, '-', '')
  ),
  -- The rank-1 row keeps the original path (and any file already written there),
  -- so a rewritten collider must be re-synced to its NEW path. Reset it to
  -- pending and clear synced_at, or a row previously marked synced would keep
  -- claiming a file that only ever existed under the old, now rank-1 name.
  "status" = 'pending',
  "synced_at" = NULL
FROM ranked
WHERE r."uuid" = ranked."uuid" AND ranked.collision_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "records_user_id_file_path_lower_unique" ON "records" USING btree ("user_id", lower("file_path") text_pattern_ops) WHERE "file_path" IS NOT NULL AND "file_path" <> '';
