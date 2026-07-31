import { sql } from "./index.js";
import { seedCatalog } from "./seedCatalog.js";
import { seedNationalZonePrices } from "./seedNationalZones.js";
import { seedCompositions } from "./seedCompositions.js";

// Já não cria contas de utilizador (super_admin/empresa de demonstração) — fazia-o com
// passwords fixas e públicas no código-fonte (achado da auditoria). O primeiro super_admin
// cria-se com `npm run bootstrap:admin`, que pede/gera uma password forte e nunca a grava no
// repositório. Empresas reais criam-se depois, autenticado, através do Painel da Plataforma.
// O que fica aqui é só dados de referência partilhados (catálogo global, zonas de preço) —
// não é sensível e é seguro semear em qualquer ambiente, incluindo produção.
async function main() {
  await seedCatalog();
  await seedCompositions();
  await seedNationalZonePrices();
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
