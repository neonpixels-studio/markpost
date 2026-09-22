CREATE TABLE "auth_failure_throttle" (
	"ip_hash" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_failure_throttle_window_start_idx" ON "auth_failure_throttle" USING btree ("window_start");