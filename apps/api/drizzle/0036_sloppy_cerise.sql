DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM project_invoices WHERE invoice_number IS NOT NULL GROUP BY project_id, invoice_number HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'SIGO migration 0036: existem números de factura repetidos na mesma obra; corrija-os antes de aplicar a migração';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_order_lines GROUP BY purchase_order_id, material_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'SIGO migration 0036: existem materiais repetidos na mesma ordem de compra; consolide as linhas antes de aplicar a migração';
  END IF;
  IF EXISTS (SELECT 1 FROM stock_movements WHERE purchase_order_id IS NOT NULL GROUP BY purchase_order_id, material_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'SIGO migration 0036: existem entradas automáticas de stock duplicadas; reconcilie-as antes de aplicar a migração';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD COLUMN "idempotency_key" varchar(100);--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD CONSTRAINT "invoice_receipt_idempotency_unique" UNIQUE("invoice_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoice_number_unique" UNIQUE("project_id","invoice_number");--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_material_unique" UNIQUE("purchase_order_id","material_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_purchase_material_unique" UNIQUE("purchase_order_id","material_id");
