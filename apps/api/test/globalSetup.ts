import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Corre uma vez, antes de toda a suite — aplica as migrations reais (drizzle-kit) à base de
// dados de teste, para os testes correrem contra o mesmo schema que a produção usa, nunca uma
// versão simplificada à parte.
export async function setup() {
  const values = loadEnv({ path: path.resolve(dirname, "../.env.test") }).parsed ?? {};
  const databaseUrl = values.DATABASE_URL;
  if (!databaseUrl || !/\/sigo_test(?:\?|$)/.test(databaseUrl)) {
    throw new Error("Global setup recusou uma base que não seja sigo_test.");
  }
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.resolve(dirname, "../drizzle") });
  } finally {
    await client.end({ timeout: 5 });
  }
}
