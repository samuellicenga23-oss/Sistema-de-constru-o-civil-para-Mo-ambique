ALTER TABLE "notifications" ADD COLUMN "priority" varchar(20) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "presented_at" timestamp;--> statement-breakpoint
CREATE TABLE "document_review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"target_type" varchar(40) NOT NULL,
	"target_id" uuid,
	"target_label_snapshot" varchar(300),
	"author_user_id" uuid NOT NULL,
	"comment" text NOT NULL,
	"parent_comment_id" uuid,
	"resolved_at" timestamp,
	"resolved_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_review_comments" ADD CONSTRAINT "document_review_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_comments" ADD CONSTRAINT "document_review_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_comments" ADD CONSTRAINT "document_review_comments_document_id_budget_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."budget_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_comments" ADD CONSTRAINT "document_review_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_review_comments_document_idx" ON "document_review_comments" USING btree ("document_id");
