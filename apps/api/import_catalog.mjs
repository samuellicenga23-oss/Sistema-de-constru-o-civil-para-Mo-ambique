import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "node:fs";

const sql = postgres(process.env.DATABASE_URL);
const data = JSON.parse(readFileSync("catalog_export.json", "utf8"));

let insertedMaterials = 0;
let insertedLabour = 0;
let insertedEquipment = 0;
let insertedCompositions = 0;
let skippedCompositions = 0;

for (const m of data.materials) {
  const existing = await sql`SELECT id FROM materials WHERE company_id IS NULL AND name = ${m.name}`;
  if (existing.length) continue;
  await sql`
    INSERT INTO materials (name, unit, base_unit_cost, import_factor, currency, purchase_package_label, purchase_package_qty)
    VALUES (${m.name}, ${m.unit}, ${m.baseUnitCost}, ${m.importFactor}, ${m.currency}, ${m.purchasePackageLabel}, ${m.purchasePackageQty})
  `;
  insertedMaterials++;
}

for (const l of data.labourCategories) {
  const existing = await sql`SELECT id FROM labour_categories WHERE company_id IS NULL AND name = ${l.name}`;
  if (existing.length) continue;
  await sql`
    INSERT INTO labour_categories (name, monthly_salary, hourly_rate, currency)
    VALUES (${l.name}, ${l.monthlySalary}, ${l.hourlyRate}, ${l.currency})
  `;
  insertedLabour++;
}

for (const e of data.equipment) {
  const existing = await sql`SELECT id FROM equipment WHERE company_id IS NULL AND name = ${e.name}`;
  if (existing.length) continue;
  await sql`
    INSERT INTO equipment (name, unit, hourly_cost, currency)
    VALUES (${e.name}, ${e.unit}, ${e.hourlyCost}, ${e.currency})
  `;
  insertedEquipment++;
}

// Mapas nome -> id (já inclui tanto o que já existia como o que acabou de ser inserido).
const materialRows = await sql`SELECT id, name FROM materials WHERE company_id IS NULL`;
const materialIdByName = new Map(materialRows.map((r) => [r.name, r.id]));
const labourRows = await sql`SELECT id, name FROM labour_categories WHERE company_id IS NULL`;
const labourIdByName = new Map(labourRows.map((r) => [r.name, r.id]));
const equipmentRows = await sql`SELECT id, name FROM equipment WHERE company_id IS NULL`;
const equipmentIdByName = new Map(equipmentRows.map((r) => [r.name, r.id]));

for (const c of data.compositions) {
  const existing = await sql`SELECT id FROM cost_compositions WHERE company_id IS NULL AND name = ${c.name}`;
  if (existing.length) {
    skippedCompositions++;
    continue;
  }
  const [composition] = await sql`
    INSERT INTO cost_compositions (name, category, output_unit, currency)
    VALUES (${c.name}, ${c.category}, ${c.outputUnit}, ${c.currency})
    RETURNING id
  `;

  for (const line of c.labourLines) {
    const labourCategoryId = labourIdByName.get(line.name);
    if (!labourCategoryId) {
      console.warn(`  aviso: mão-de-obra "${line.name}" não encontrada para a composição "${c.name}"`);
      continue;
    }
    await sql`INSERT INTO composition_labour_lines (composition_id, labour_category_id, qty_per_unit) VALUES (${composition.id}, ${labourCategoryId}, ${line.qtyPerUnit})`;
  }
  for (const line of c.materialLines) {
    const materialId = materialIdByName.get(line.name);
    if (!materialId) {
      console.warn(`  aviso: material "${line.name}" não encontrado para a composição "${c.name}"`);
      continue;
    }
    await sql`INSERT INTO composition_material_lines (composition_id, material_id, qty_per_unit) VALUES (${composition.id}, ${materialId}, ${line.qtyPerUnit})`;
  }
  for (const line of c.equipmentLines) {
    const equipmentId = equipmentIdByName.get(line.name);
    if (!equipmentId) {
      console.warn(`  aviso: equipamento "${line.name}" não encontrado para a composição "${c.name}"`);
      continue;
    }
    await sql`INSERT INTO composition_equipment_lines (composition_id, equipment_id, qty_per_unit) VALUES (${composition.id}, ${equipmentId}, ${line.qtyPerUnit})`;
  }
  insertedCompositions++;
}

console.log(
  `Materiais novos: ${insertedMaterials}. Mão-de-obra nova: ${insertedLabour}. Equipamento novo: ${insertedEquipment}. Composições novas: ${insertedCompositions} (já existiam: ${skippedCompositions}).`
);
await sql.end();
