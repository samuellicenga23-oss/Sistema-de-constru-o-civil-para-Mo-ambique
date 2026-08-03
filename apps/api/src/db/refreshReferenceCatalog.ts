import { sql } from "./index.js";
import { seedCatalog } from "./seedCatalog.js";
import { ensureDefaultWorkChapterLibrary } from "../services/boqTemplate.js";

async function main() {
  await seedCatalog();
  await ensureDefaultWorkChapterLibrary();
  console.log("Preços-base, mão-de-obra e descrições padrão actualizados.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
