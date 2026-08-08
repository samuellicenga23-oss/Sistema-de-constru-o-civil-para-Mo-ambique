CREATE TYPE "public"."goods_receipt_status" AS ENUM('rascunho', 'confirmado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_fulfillment_status" AS ENUM('aguarda_confirmacao', 'confirmado', 'em_preparacao', 'pronto_expedir', 'em_transito', 'parcialmente_recebido', 'recebido', 'fechado');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_shipment_status" AS ENUM('rascunho', 'pronto', 'expedido', 'entregue', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_supplier_confirmation_status" AS ENUM('pendente', 'confirmado', 'alteracao_solicitada', 'recusado');--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"delivered_qty" numeric(14, 3) NOT NULL,
	"accepted_qty" numeric(14, 3) NOT NULL,
	"rejected_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"rejection_reason" text,
	"condition_notes" text,
	"unit_cost" numeric(14, 4) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	CONSTRAINT "goods_receipt_order_line_unique" UNIQUE("goods_receipt_id","purchase_order_line_id")
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"shipment_id" uuid,
	"reference" varchar(50) NOT NULL,
	"status" "goods_receipt_status" DEFAULT 'rascunho' NOT NULL,
	"receipt_date" date NOT NULL,
	"delivery_note_number" varchar(160),
	"inspection_notes" text,
	"received_by_user_id" uuid,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_shipment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	CONSTRAINT "purchase_order_shipment_line_unique" UNIQUE("shipment_id","purchase_order_line_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"reference" varchar(50) NOT NULL,
	"status" "purchase_order_shipment_status" DEFAULT 'rascunho' NOT NULL,
	"expected_delivery_date" date,
	"carrier" varchar(200),
	"vehicle_plate" varchar(80),
	"driver_name" varchar(160),
	"driver_phone" varchar(80),
	"tracking_reference" varchar(160),
	"supplier_notes" text,
	"created_by_supplier_account_id" uuid,
	"ready_at" timestamp,
	"dispatched_at" timestamp,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_supplier_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_account_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_purchase_material_unique";--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_confirmation_status" "purchase_order_supplier_confirmation_status" DEFAULT 'pendente' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "fulfillment_status" "purchase_order_fulfillment_status" DEFAULT 'aguarda_confirmacao' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "promised_delivery_date" date;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_response_notes" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "last_supplier_update_at" timestamp;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "goods_receipt_line_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_shipment_id_purchase_order_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."purchase_order_shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_shipment_lines" ADD CONSTRAINT "purchase_order_shipment_lines_shipment_id_purchase_order_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."purchase_order_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_shipment_lines" ADD CONSTRAINT "purchase_order_shipment_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_shipments" ADD CONSTRAINT "purchase_order_shipments_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_shipments" ADD CONSTRAINT "purchase_order_shipments_created_by_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("created_by_supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_supplier_events" ADD CONSTRAINT "purchase_order_supplier_events_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_supplier_events" ADD CONSTRAINT "purchase_order_supplier_events_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_reference_idx" ON "goods_receipts" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "goods_receipt_shipment_idx" ON "goods_receipts" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_order_date_idx" ON "goods_receipts" USING btree ("purchase_order_id","receipt_date");--> statement-breakpoint
CREATE INDEX "purchase_order_shipment_reference_idx" ON "purchase_order_shipments" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "purchase_order_shipment_order_status_idx" ON "purchase_order_shipments" USING btree ("purchase_order_id","status");--> statement-breakpoint
CREATE INDEX "purchase_order_supplier_event_order_idx" ON "purchase_order_supplier_events" USING btree ("purchase_order_id","created_at");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_goods_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_goods_receipt_line_unique" UNIQUE("goods_receipt_line_id");
--> statement-breakpoint
UPDATE "purchase_orders"
SET "supplier_confirmation_status" = 'confirmado',
    "fulfillment_status" = 'recebido'
WHERE "status" = 'recebido';