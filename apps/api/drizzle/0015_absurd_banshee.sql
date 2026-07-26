ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_purchase_order_id_purchase_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;