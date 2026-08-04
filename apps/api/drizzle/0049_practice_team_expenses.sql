CREATE TYPE "public"."practice_team_pay_mode" AS ENUM('fixo', 'percentagem', 'hora', 'dia', 'entregavel', 'fase');--> statement-breakpoint
CREATE TYPE "public"."practice_team_pay_status" AS ENUM('pendente', 'parcial', 'pago');--> statement-breakpoint
CREATE TYPE "public"."practice_expense_kind" AS ENUM('interno', 'reembolsavel');--> statement-breakpoint
ALTER TABLE "practice_engagements" ADD COLUMN "service_project_type" varchar(80);--> statement-breakpoint
ALTER TABLE "practice_engagements" ADD COLUMN "service_type" varchar(80);--> statement-breakpoint
CREATE TABLE "practice_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"role" varchar(120) NOT NULL,
	"specialty" varchar(120),
	"contact" varchar(200),
	"is_external" boolean DEFAULT false NOT NULL,
	"pay_mode" "practice_team_pay_mode" DEFAULT 'fixo' NOT NULL,
	"agreed_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"percent" numeric(5, 2),
	"hourly_rate" numeric(14, 2),
	"hours" numeric(10, 2),
	"daily_rate" numeric(14, 2),
	"days" numeric(10, 2),
	"deliverable_label" varchar(200),
	"phase_label" varchar(120),
	"planned_pay_date" date,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"pay_status" "practice_team_pay_status" DEFAULT 'pendente' NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "practice_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"kind" "practice_expense_kind" DEFAULT 'interno' NOT NULL,
	"category" varchar(80) NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"incurred_date" date,
	"paid_at" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "practice_team_members" ADD CONSTRAINT "practice_team_members_engagement_id_practice_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."practice_engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_expenses" ADD CONSTRAINT "practice_expenses_engagement_id_practice_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."practice_engagements"("id") ON DELETE cascade ON UPDATE no action;
