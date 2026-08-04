CREATE TYPE "public"."practice_phase_status" AS ENUM('nao_iniciado', 'em_preparacao', 'em_curso', 'aguardando_cliente', 'aguardando_terceiro', 'em_revisao', 'concluido', 'suspenso', 'atrasado');--> statement-breakpoint
CREATE TYPE "public"."practice_deliverable_status" AS ENUM('pendente', 'em_curso', 'entregue', 'em_revisao', 'aprovado', 'rejeitado');--> statement-breakpoint
CREATE TYPE "public"."practice_addendum_kind" AS ENUM('trabalho_adicional', 'alteracao_escopo', 'nova_especialidade', 'revisao_extraordinaria', 'extensao_fiscalizacao', 'consultoria_adicional');--> statement-breakpoint
CREATE TYPE "public"."practice_addendum_status" AS ENUM('rascunho', 'enviada', 'aprovada', 'rejeitada', 'cancelada');--> statement-breakpoint
CREATE TABLE "practice_schedule_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"assignee_name" varchar(200),
	"start_date" date,
	"end_date" date,
	"duration_days" integer,
	"status" "practice_phase_status" DEFAULT 'nao_iniciado' NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "practice_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"phase_id" uuid,
	"title" varchar(240) NOT NULL,
	"assignee_name" varchar(200),
	"due_date" date,
	"status" "practice_deliverable_status" DEFAULT 'pendente' NOT NULL,
	"delivered_at" date,
	"revision_number" integer DEFAULT 0 NOT NULL,
	"version" varchar(40),
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "practice_client_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"phase_id" uuid,
	"deliverable_id" uuid,
	"revision_date" date NOT NULL,
	"description" text NOT NULL,
	"assignee_name" varchar(200),
	"impact_days" integer DEFAULT 0 NOT NULL,
	"impact_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"included_in_contract" boolean DEFAULT true NOT NULL,
	"is_additional_work" boolean DEFAULT false NOT NULL,
	"addendum_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "practice_addenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"revision_id" uuid,
	"quote_id" uuid,
	"addendum_number" varchar(80),
	"kind" "practice_addendum_kind" DEFAULT 'trabalho_adicional' NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"impact_days" integer DEFAULT 0 NOT NULL,
	"status" "practice_addendum_status" DEFAULT 'rascunho' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "practice_schedule_phases" ADD CONSTRAINT "practice_schedule_phases_engagement_id_practice_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."practice_engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_deliverables" ADD CONSTRAINT "practice_deliverables_engagement_id_practice_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."practice_engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_deliverables" ADD CONSTRAINT "practice_deliverables_phase_id_practice_schedule_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."practice_schedule_phases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_client_revisions" ADD CONSTRAINT "practice_client_revisions_engagement_id_practice_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."practice_engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_client_revisions" ADD CONSTRAINT "practice_client_revisions_phase_id_practice_schedule_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."practice_schedule_phases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_client_revisions" ADD CONSTRAINT "practice_client_revisions_deliverable_id_practice_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."practice_deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_addenda" ADD CONSTRAINT "practice_addenda_engagement_id_practice_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."practice_engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_addenda" ADD CONSTRAINT "practice_addenda_revision_id_practice_client_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."practice_client_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_addenda" ADD CONSTRAINT "practice_addenda_quote_id_practice_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."practice_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_addenda" ADD CONSTRAINT "practice_addenda_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
