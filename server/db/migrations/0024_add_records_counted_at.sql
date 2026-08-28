-- Idempotency marker for the source recordCount bump (see
-- server/api/hooks/[slug].post.ts). Added with a DEFAULT of now() so every
-- pre-existing row reads back non-NULL and is therefore NOT claimable — those
-- deliveries were already tallied by the old unconditional increment, and this
-- avoids the unowed second bump a NULL would invite on a provider retry. The
-- DEFAULT is then dropped so rows inserted afterwards get NULL and are claimed
-- on their first ingest side effects. Postgres 11+ stores the added column's
-- default in the catalog (no table rewrite), so this stays O(1) even on a large
-- records table; the final column carries no default, matching the snapshot.
-- Note: rows inserted by the OLD handler in the gap between this migration and
-- the new code going live land with counted_at NULL and can double-count once on
-- a retry within that narrow deploy window; acceptable given the window and the
-- provider retry horizon.
ALTER TABLE "records" ADD COLUMN "counted_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "counted_at" DROP DEFAULT;
