import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Corre uma vez, antes de toda a suite — aplica as migrations reais (drizzle-kit) à base de
// dados de teste, para os testes correrem contra o mesmo schema que a produção usa, nunca uma
// versão simplificada à parte.
export async function setup() {
  loadEnv({ path: path.resolve(dirname, "../.env.test") });
  execSync("npx tsx src/db/migrate.ts", { stdio: "inherit", cwd: path.resolve(dirname, ".."), env: process.env });
}
