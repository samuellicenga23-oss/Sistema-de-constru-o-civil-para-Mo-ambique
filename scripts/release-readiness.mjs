#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const structuralOnly = process.argv.includes("--structural-only");
const requiredFiles = [
  "package-lock.json",
  "apps/api/.env.example",
  "apps/api/drizzle/meta/_journal.json",
  "deploy/preflight.sh",
  "deploy/backup.sh",
  "deploy/deploy.sh",
  "deploy/rollback.sh",
  "deploy/status.sh",
  "scripts/production-smoke.mjs",
  "scripts/backup-manifest.mjs",
  "docs/RELEASE_GATES.md",
  "docs/RELEASE.md",
];
const failures = [];
const warnings = [];
for (const file of requiredFiles) if (!existsSync(file)) failures.push(`Ficheiro obrigatório em falta: ${file}`);

const run = (command, args, opts = {}) => spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...opts });
const tracked = run("git", ["ls-files"]);
if (tracked.status !== 0) failures.push("Não foi possível consultar os ficheiros rastreados pelo Git.");
else {
  const sensitive = tracked.stdout.split(/\r?\n/).filter((file) => /(^|\/)(\.env(?:\..+)?|id_(?:rsa|ed25519)(?:\..+)?|.+\.(?:pem|key|p12|pfx))$/i.test(file) && !file.endsWith(".example"));
  if (sensitive.length) failures.push(`Ficheiros potencialmente sensíveis no Git: ${sensitive.join(", ")}`);
}

const envExample = existsSync("apps/api/.env.example") ? readFileSync("apps/api/.env.example", "utf8") : "";
for (const variable of ["DATABASE_URL", "SESSION_COOKIE_SECRET", "PLANT_SERVICE_TOKEN", "PUBLIC_URL", "SIGO_BACKUP_DIR"]) {
  if (!new RegExp(`^${variable}=`, "m").test(envExample)) failures.push(`Variável não documentada em apps/api/.env.example: ${variable}`);
}

const journal = existsSync("apps/api/drizzle/meta/_journal.json") ? JSON.parse(readFileSync("apps/api/drizzle/meta/_journal.json", "utf8")) : null;
if (!Array.isArray(journal?.entries) || journal.entries.length === 0) failures.push("Manifesto de migrations vazio ou inválido.");
const diff = run("git", ["diff", "--check"]);
if (diff.status !== 0) failures.push(`Erros de whitespace no diff:\n${diff.stdout || diff.stderr}`);
const status = run("git", ["status", "--porcelain"]);
if (status.status === 0 && status.stdout.trim()) warnings.push("A árvore local tem alterações; isto é aceitável em desenvolvimento, mas a VPS exige uma árvore limpa.");

function step(label, command, args) {
  console.log(`\n▶ ${label}`);
  const result = run(command, args, { shell: process.platform === "win32" });
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    const termination = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    failures.push(`${label} falhou (${termination})`);
  } else console.log(`✓ ${label}`);
}

for (const warning of warnings) console.warn(`AVISO: ${warning}`);
if (failures.length) {
  for (const failure of failures) console.error(`ERRO: ${failure}`);
  console.error(`\nProntidão reprovada: ${failures.length} bloqueio(s).`);
  process.exit(1);
}

console.log(`Prontidão estrutural aprovada: ${requiredFiles.length} ficheiros verificados.`);

// No CI, build/migrations/testes são passos explícitos do workflow: correr tudo novamente
// dentro de spawnSync duplica CPU/RAM, mascara a etapa que falhou e pode terminar por sinal.
// O modo local normal continua a ser o gate completo e mantém o comportamento histórico.
if (structuralOnly) {
  console.log("✓ quality:release estrutural concluído — sem duplicar build/testes do CI.");
  process.exit(0);
}

step("Typecheck shared", "npm", ["run", "build:shared"]);
step("Typecheck API", "npm", ["run", "build", "--workspace=apps/api"]);
step("Typecheck web", "npm", ["run", "build", "--workspace=apps/web"]);
step("Testes API", "npm", ["run", "test", "--workspace=apps/api"]);
step("Testes web", "npm", ["run", "test", "--workspace=apps/web"]);

if (failures.length) {
  for (const failure of failures) console.error(`ERRO: ${failure}`);
  console.error(`\nProntidão reprovada: ${failures.length} bloqueio(s).`);
  process.exit(1);
}

console.log("\n✓ quality:release concluído — estrutura, typecheck e testes OK.");
