ALTER TABLE "materials" ADD COLUMN "purchase_package_label" varchar(100);--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "purchase_package_qty" numeric(14, 4);--> statement-breakpoint
-- Valores de partida para a unidade de compra de mercado (editável depois no Catálogo, por
-- material — a dimensão real do camião/rolo/palete varia por fornecedor). Só se aplica a
-- materiais cuja unidade de MEDIDA usada nas composições difere da unidade em que o mercado
-- realmente vende (ex: areia medida em m3 mas vendida por camião); materiais já vendidos na
-- própria unidade de medida (kg ao peso, "un" já por peça/kit, "vg" verba) ficam sem embalagem
-- (NULL) — mostrados no relatório apenas na unidade de medida, sem conversão. Aplica-se apenas ao
-- catálogo partilhado (company_id NULL); clones já feitos por empresas não são tocados.
UPDATE "materials" SET "purchase_package_label" = 'Camião 10m³', "purchase_package_qty" = 10 WHERE "company_id" IS NULL AND "name" IN ('Areia grossa', 'Areia fina', 'Brita 3/4', 'Saibro', 'Terras de empréstimo (posto em obra)');--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Saco 50kg', "purchase_package_qty" = 1 WHERE "company_id" IS NULL AND "name" = 'Cimento (saco 50kg)';--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Saco 20kg', "purchase_package_qty" = 20 WHERE "company_id" IS NULL AND "name" = 'Cimento cola';--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Palete (100 un)', "purchase_package_qty" = 100 WHERE "company_id" IS NULL AND "name" IN ('Bloco de cimento 20x20x40', 'Bloco de cimento 15x20x40');--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Milheiro (1000 un)', "purchase_package_qty" = 1000 WHERE "company_id" IS NULL AND "name" = 'Tijolo furado 30x20x15';--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Folha 14,4m²', "purchase_package_qty" = 14.4 WHERE "company_id" IS NULL AND "name" = 'Malhasol AQ38';--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Rolo 100m²', "purchase_package_qty" = 100 WHERE "company_id" IS NULL AND "name" = 'Membrana polietileno 275 micron';--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Rolo 10m²', "purchase_package_qty" = 10 WHERE "company_id" IS NULL AND "name" IN ('Tela asfáltica impermeabilizante', 'Tela betuminosa para fundações');--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Placa 2m²', "purchase_package_qty" = 2 WHERE "company_id" IS NULL AND "name" = 'Poliestireno expandido (isolamento)';--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Placa 2,88m²', "purchase_package_qty" = 2.88 WHERE "company_id" IS NULL AND "name" = 'Placa de gesso cartonado';--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Vara 6m', "purchase_package_qty" = 6 WHERE "company_id" IS NULL AND "name" IN ('Tubo uPVC Ø110mm', 'Tubo uPVC Ø40mm', 'Tubo PVC Ø80mm (queda)');--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Vara 4m', "purchase_package_qty" = 4 WHERE "company_id" IS NULL AND "name" = 'Tubo PPR 20mm (água)';--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Rolo 100m', "purchase_package_qty" = 100 WHERE "company_id" IS NULL AND "name" = 'Cabo eléctrico 2.5mm²';--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Caixa 2m²', "purchase_package_qty" = 2 WHERE "company_id" IS NULL AND "name" = 'Mosaico cerâmico';--> statement-breakpoint
UPDATE "materials" SET "purchase_package_label" = 'Pacote 200un', "purchase_package_qty" = 200 WHERE "company_id" IS NULL AND "name" = 'Cruzetas para juntas';