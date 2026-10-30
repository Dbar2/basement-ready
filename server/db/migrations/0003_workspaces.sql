CREATE TABLE "workspaces" (
	"basement_id" uuid PRIMARY KEY NOT NULL,
	"profile" jsonb,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_basement_id_basements_id_fk" FOREIGN KEY ("basement_id") REFERENCES "public"."basements"("id") ON DELETE cascade ON UPDATE no action;