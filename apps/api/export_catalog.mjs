import "dotenv/config";
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const sql = postgres(process.env.DATABASE_URL);

const materials = await sql`
  SELECT name, unit, base_unit_cost AS "baseUnitCost", import_factor AS "importFactor", currency,
         purchase_package_label AS "purchasePackageLabel", purchase_package_qty AS "purchasePackageQty"
  FROM materials WHERE company_id IS NULL ORDER BY name
`;
const labourCategories = await sql`
  SELECT name, monthly_salary AS "monthlySalary", hourly_rate AS "hourlyRate", currency
  FROM labour_categories WHERE company_id IS NULL ORDER BY name
`;
const equipment = await sql`
  SELECT name, unit, hourly_cost AS "hourlyCost", currency
  FROM equipment WHERE company_id IS NULL ORDER BY name
`;

const compositionsRaw = await sql`
  SELECT id, name, category, output_unit AS "outputUnit", currency
  FROM cost_compositions WHERE company_id IS NULL ORDER BY category, name
`;

const compositions = [];
for (const c of compositionsRaw) {
  const labourLines = await sql`
    SELECT lc.name, cll.qty_per_unit AS "qtyPerUnit"
    FROM composition_labour_lines cll JOIN labour_categories lc ON lc.id = cll.labour_category_id
    WHERE cll.composition_id = ${c.id}
  `;
  const materialLines = await sql`
    SELECT m.name, cml.qty_per_unit AS "qtyPerUnit"
    FROM composition_material_lines cml JOIN materials m ON m.id = cml.material_id
    WHERE cml.composition_id = ${c.id}
  `;
  const equipmentLines = await sql`
    SELECT e.name, cel.qty_per_unit AS "qtyPerUnit"
    FROM composition_equipment_lines cel JOIN equipment e ON e.id = cel.equipment_id
    WHERE cel.composition_id = ${c.id}
  `;
  compositions.push({
    name: c.name,
    category: c.category,
    outputUnit: c.outputUnit,
    currency: c.currency,
    labourLines: labourLines.map((l) => ({ name: l.name, qtyPerUnit: l.qtyPerUnit })),
    materialLines: materialLines.map((l) => ({ name: l.name, qtyPerUnit: l.qtyPerUnit })),
    equipmentLines: equipmentLines.map((l) => ({ name: l.name, qtyPerUnit: l.qtyPerUnit })),
  });
}

const out = { materials, labourCategories, equipment, compositions };
writeFileSync("catalog_export.json", JSON.stringify(out, null, 2));
console.log(`Exportado: ${materials.length} materiais, ${labourCategories.length} mão-de-obra, ${equipment.length} equipamentos, ${compositions.length} composições.`);
await sql.end();
