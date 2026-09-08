-- Close the ok/err dedup race at the database level. writeEventOncePerRecord
-- (server/utils/eventWriter.ts) used to check-then-act (SELECT, then INSERT if
-- absent), which two concurrent writers could both pass, each inserting an
-- "ok"/"err" event for the same (record_uuid, kind). A UNIQUE (record_uuid,
-- kind) index makes that impossible for those two kinds; the insert path pairs
-- it with onConflictDoNothing so a losing writer's insert is a no-op instead of
-- a duplicate row.
--
-- Dedupe existing colliders FIRST, or the unique index cannot be created —
-- rows from the pre-fix race are already sitting in the table. Keep the
-- earliest event per (record_uuid, kind) (deterministic: ts, then id) and
-- delete the rest; the extra rows were always cosmetic duplicates in the
-- activity log, never a source of truth (recordCount is guarded separately by
-- the record's counted_at claim), so deleting them loses nothing. Partial:
-- NULL record_uuid or a kind other than ok/err never collides and is left
-- untouched, matching the partial unique index below.
DELETE FROM "events" e
USING (
  SELECT "id", row_number() OVER (
    PARTITION BY "record_uuid", "kind" ORDER BY "ts", "id"
  ) AS dup_rank
  FROM "events"
  WHERE "record_uuid" IS NOT NULL AND "kind" IN ('ok', 'err')
) ranked
WHERE e."id" = ranked."id" AND ranked.dup_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "events_record_uuid_kind_ok_err_unique" ON "events" USING btree ("record_uuid","kind") WHERE "events"."record_uuid" is not null and "events"."kind" in ('ok', 'err');
