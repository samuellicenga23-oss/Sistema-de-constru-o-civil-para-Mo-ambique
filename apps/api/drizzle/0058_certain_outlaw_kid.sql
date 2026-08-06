ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_token" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_expires_at" timestamp;--> statement-breakpoint
-- Contas já existentes (todas criadas por um admin, nunca por registo público) ficam
-- automaticamente marcadas como verificadas — só o registo público exige confirmação.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;