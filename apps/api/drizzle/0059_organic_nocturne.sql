ALTER TABLE "projects" ADD COLUMN "public_share_token" varchar(64);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_public_share_token_unique" UNIQUE("public_share_token");