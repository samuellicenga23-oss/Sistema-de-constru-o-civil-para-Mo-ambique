ALTER TABLE "practice_quotes" ADD COLUMN "expected_close_date" date;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "loss_reason" varchar(200);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD CONSTRAINT "practice_quotes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
