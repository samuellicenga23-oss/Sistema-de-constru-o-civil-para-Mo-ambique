ALTER TABLE "users" ADD COLUMN "password_reset_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_password_reset_token_hash_unique" UNIQUE("password_reset_token_hash");
