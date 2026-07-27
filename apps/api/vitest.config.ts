import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
// Nunca correr testes contra a base de dados de desenvolvimento — .env.test aponta para
// "sigo_test", uma base separada, recriada pelo globalSetup antes da suite.
const testEnv = loadEnv({ path: path.resolve(dirname, ".env.test") }).parsed ?? {};

export default defineConfig({
  test: {
    environment: "node",
    env: testEnv,
    globalSetup: "./test/globalSetup.ts",
    testTimeout: 20000,
    hookTimeout: 30000,
    // Vários ficheiros de teste partilham a mesma base "sigo_test" — correr em série evita
    // corridas entre ficheiros a limpar/semear tabelas ao mesmo tempo.
    fileParallelism: false,
  },
});
