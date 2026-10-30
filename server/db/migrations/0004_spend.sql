CREATE TABLE "spend" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"usd" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "spend_created_idx" ON "spend" USING btree ("created_at");