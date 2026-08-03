import { db, sql } from "./index.js";
import { companies } from "./schema.js";
import { syncSigoPricesForCompany } from "../services/sigoPrices.js";

async function main() {
  const companyRows = await db.select({ id: companies.id, name: companies.name }).from(companies);
  let materialPrices = 0;
  for (const company of companyRows) {
    const result = await syncSigoPricesForCompany(company.id);
    materialPrices += result.materials;
    console.log(`${company.name}: ${result.materials} materiais (${result.created} novos, ${result.updated} actualizados)`);
  }
  console.log(`SIGO Preços sincronizado para ${companyRows.length} empresa(s), ${materialPrices} preço(s) de referência.`);
  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
