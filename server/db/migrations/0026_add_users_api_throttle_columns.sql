ALTER TABLE "users" ADD COLUMN "api_throttle_window_start" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "api_throttle_count" integer DEFAULT 0 NOT NULL;
