-- events.source_id previously had no FK to sources, so deleting a source left
-- rows pointing at a now-gone sources.uuid and silently broke event-to-source
-- lookups. Null any already-orphaned references first so the constraint can be
-- created cleanly, then add the FK with ON DELETE SET NULL (mirrors the
-- records.source_id FK added in 0013).
UPDATE "events" SET "source_id" = NULL WHERE "source_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sources" WHERE "sources"."uuid" = "events"."source_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_source_id_sources_uuid_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("uuid") ON DELETE set null ON UPDATE no action;