import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(dirname, "..");
// Corre o próprio ficheiro JS do tsx com o node directamente (nunca o shim .cmd do Windows) —
// execFileSync com array de argumentos lida bem com espaços no caminho sem precisar de shell.
const tsxCli = path.resolve(apiRoot, "../../node_modules/tsx/dist/cli.mjs");

// env.ts decide tudo isto ao ser importado (não é uma função que se possa chamar isoladamente
// no mesmo processo sem afectar os outros testes, que também importam módulos que importam
// env.ts) — por isso cada cenário corre num processo Node novo, exactamente como testado
// manualmente na Etapa 2.
function tryImportEnv(extraEnv: Record<string, string | undefined>): { ok: boolean; output: string } {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  try {
    const output = execFileSync(process.execPath, [tsxCli, "--eval", "import('./src/env.ts')"], {
      cwd: apiRoot,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, output: (e.stderr ?? "") + (e.stdout ?? "") + (e.message ?? "") };
  }
}

describe("Guardas de produção (env.ts)", () => {
  const base = { DATABASE_URL: "postgres://x:x@localhost:5432/x", NODE_ENV: "production" };

  it("recusa arrancar em produção sem SESSION_COOKIE_SECRET", () => {
    const result = tryImportEnv({ ...base, SESSION_COOKIE_SECRET: undefined, PLANT_SERVICE_TOKEN: "algo" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("SESSION_COOKIE_SECRET");
  });

  it("recusa arrancar em produção com o valor de desenvolvimento de SESSION_COOKIE_SECRET", () => {
    const result = tryImportEnv({ ...base, SESSION_COOKIE_SECRET: "dev-secret-change-me", PLANT_SERVICE_TOKEN: "algo" });
    expect(result.ok).toBe(false);
  });

  it("recusa arrancar em produção sem PLANT_SERVICE_TOKEN", () => {
    const result = tryImportEnv({ ...base, SESSION_COOKIE_SECRET: "algo-forte", PLANT_SERVICE_TOKEN: undefined });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("PLANT_SERVICE_TOKEN");
  });

  it("arranca em produção quando os segredos e o URL público estão definidos", () => {
    const result = tryImportEnv({
      ...base,
      SESSION_COOKIE_SECRET: "algo-forte-aleatorio",
      PLANT_SERVICE_TOKEN: "token-forte",
      PUBLIC_URL: "https://sigomz.com",
    });
    expect(result.ok).toBe(true);
  });

  it("recusa arrancar em produção sem PUBLIC_URL/FRONTEND_URL/SUPPLIER_PUBLIC_URL", () => {
    const result = tryImportEnv({
      ...base,
      SESSION_COOKIE_SECRET: "algo-forte-aleatorio",
      PLANT_SERVICE_TOKEN: "token-forte",
      PUBLIC_URL: undefined,
      FRONTEND_URL: undefined,
      SUPPLIER_PUBLIC_URL: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("PUBLIC_URL");
  });

  it("em desenvolvimento arranca sem nenhum dos dois segredos", () => {
    const result = tryImportEnv({
      DATABASE_URL: "postgres://x:x@localhost:5432/x",
      NODE_ENV: undefined,
      SESSION_COOKIE_SECRET: undefined,
      PLANT_SERVICE_TOKEN: undefined,
    });
    expect(result.ok).toBe(true);
  });
});
