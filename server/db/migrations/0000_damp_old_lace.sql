CREATE TABLE "answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"basement_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "basements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text,
	"claim_token" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"municipality" text DEFAULT 'waterloo-on' NOT NULL,
	"household" text DEFAULT 'unsure' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 2 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" uuid NOT NULL,
	"at" double precision NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"basement_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"video_key" text,
	"frame_count" integer,
	"transcript" text,
	"result" jsonb,
	"error" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"client_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"role" text DEFAULT 'homeowner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_basement_id_basements_id_fk" FOREIGN KEY ("basement_id") REFERENCES "public"."basements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basements" ADD CONSTRAINT "basements_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_basement_id_basements_id_fk" FOREIGN KEY ("basement_id") REFERENCES "public"."basements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_basement_rule_idx" ON "answers" USING btree ("basement_id","rule_id");--> statement-breakpoint
CREATE INDEX "basements_owner_idx" ON "basements" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("status","run_after") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "scan_events_scan_idx" ON "scan_events" USING btree ("scan_id","id");--> statement-breakpoint
CREATE INDEX "scans_basement_idx" ON "scans" USING btree ("basement_id");--> statement-breakpoint
CREATE INDEX "scans_created_idx" ON "scans" USING btree ("created_at");