ALTER TABLE "budget_documents" ALTER COLUMN "iva_rate" SET DEFAULT '0.16';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "iva_rate" SET DEFAULT '0.16';--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "iva_rate" numeric(5, 4) DEFAULT '0.16' NOT NULL;--> statement-breakpoint
UPDATE "projects" SET "iva_rate" = '0.16' WHERE "iva_rate" = '0.17';--> statement-breakpoint
UPDATE "budget_documents" SET "iva_rate" = '0.16' WHERE "iva_rate" = '0.17';--> statement-breakpoint
UPDATE "financial_entries" AS "entry"
SET "amount" = ROUND("totals"."amount", 2)
FROM (
	SELECT "order"."id" AS "source_id", SUM("line"."quantity" * "line"."unit_cost") * (1 + "order"."iva_rate") AS "amount"
	FROM "purchase_orders" AS "order"
	INNER JOIN "purchase_order_lines" AS "line" ON "line"."purchase_order_id" = "order"."id"
	GROUP BY "order"."id", "order"."iva_rate"
) AS "totals"
WHERE "entry"."source_type" = 'purchase_order' AND "entry"."status" = 'pendente' AND "entry"."source_id" = "totals"."source_id";--> statement-breakpoint
UPDATE "financial_entries" AS "entry"
SET "amount" = ROUND("totals"."amount", 2)
FROM (
	SELECT "certificate"."id" AS "source_id", SUM("line"."period_qty" * "item"."unit_price") * (1 + "document"."contingencias_rate") * (1 + "document"."iva_rate") AS "amount"
	FROM "measurement_certificates" AS "certificate"
	INNER JOIN "measurement_certificate_lines" AS "line" ON "line"."certificate_id" = "certificate"."id"
	INNER JOIN "line_items" AS "item" ON "item"."id" = "line"."line_item_id"
	INNER JOIN "budget_documents" AS "document" ON "document"."id" = "certificate"."budget_document_id"
	GROUP BY "certificate"."id", "document"."contingencias_rate", "document"."iva_rate"
) AS "totals"
WHERE "entry"."source_type" = 'measurement_certificate' AND "entry"."status" = 'pendente' AND "entry"."source_id" = "totals"."source_id";
