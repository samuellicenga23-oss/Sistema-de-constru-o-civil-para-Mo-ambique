CREATE TYPE "public"."composition_visibility" AS ENUM('private', 'shared', 'company', 'global');--> statement-breakpoint
CREATE TYPE "public"."composition_share_permission" AS ENUM('view', 'edit');--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "visibility" "composition_visibility" DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "parent_composition_id" uuid;--> statement-breakpoint
UPDATE "cost_compositions" SET "visibility" = 'global' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "cost_compositions" SET "visibility" = 'company' WHERE "company_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD CONSTRAINT "cost_compositions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD CONSTRAINT "cost_compositions_parent_composition_id_cost_compositions_id_fk" FOREIGN KEY ("parent_composition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "composition_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"composition_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" "composition_share_permission" DEFAULT 'view' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "composition_shares" ADD CONSTRAINT "composition_shares_composition_id_cost_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_shares" ADD CONSTRAINT "composition_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_shares" ADD CONSTRAINT "composition_shares_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_shares" ADD CONSTRAINT "composition_shares_pair_unique" UNIQUE("composition_id","user_id");--> statement-breakpoint
CREATE INDEX "composition_shares_user_idx" ON "composition_shares" USING btree ("user_id");
