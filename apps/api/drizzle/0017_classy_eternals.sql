ALTER TABLE "purchase_order_lines" ALTER COLUMN "material_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "material_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP COLUMN "material_name";--> statement-breakpoint
ALTER TABLE "purchase_order_lines" DROP COLUMN "unit";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP COLUMN "material_name";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP COLUMN "unit";