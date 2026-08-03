CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"actor_user_id" uuid,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid,
	"action" varchar(80) NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
