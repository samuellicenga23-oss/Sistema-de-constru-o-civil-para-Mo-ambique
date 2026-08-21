#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const drizzleDir = "apps/api/drizzle";
const journalPath = `${drizzleDir}/meta/_journal.json`;
const schemaPath = "apps/api/src/db/schema.ts";
const failures = [];
const warnings = [];

if (!existsSync(journalPath)) failures.push(`Journal em falta: ${journalPath}`);

const migrationFiles = readdirSync(drizzleDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const migrationTags = new Set(migrationFiles.map((name) => name.replace(/\.sql$/, "")));

const journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, "utf8")) : { entries: [] };
const entries = Array.isArray(journal.entries) ? journal.entries : [];
const journalTags = new Set(entries.map((entry) => entry.tag));

if (!entries.length) failures.push("Journal de migrations vazio.");

for (let index = 0; index < entries.length; index += 1) {
  const entry = entries[index];
  if (entry.idx !== index) failures.push(`Índice do journal incoerente: posição ${index}, idx=${entry.idx}.`);
  if (!migrationTags.has(entry.tag)) failures.push(`Migration registada no journal sem SQL correspondente: ${entry.tag}.sql`);
  if (index > 0 && Number(entry.when) <= Number(entries[index - 1].when)) {
    failures.push(`Timestamps do journal fora de ordem entre ${entries[index - 1].tag} e ${entry.tag}.`);
  }
}

for (const tag of migrationTags) {
  if (!journalTags.has(tag)) failures.push(`SQL de migration sem entrada no journal: ${tag}.sql`);
}

const duplicateTags = entries
  .map((entry) => entry.tag)
  .filter((tag, index, all) => all.indexOf(tag) !== index);
if (duplicateTags.length) failures.push(`Tags duplicadas no journal: ${[...new Set(duplicateTags)].join(", ")}`);

const snapshots = readdirSync(`${drizzleDir}/meta`)
  .filter((name) => /^\d{4}_snapshot\.json$/.test(name))
  .sort();
if (snapshots.length) {
  const latestSnapshot = Number(snapshots.at(-1).slice(0, 4));
  const latestJournalIdx = entries.at(-1)?.idx ?? -1;
  if (latestSnapshot < latestJournalIdx) {
    warnings.push(
      `Snapshots Drizzle terminam em ${snapshots.at(-1)}, enquanto o journal vai até idx ${latestJournalIdx}. ` +
      "As migrations posteriores são manuais; não use drizzle-kit generate como verificação de drift até a metadata histórica ser reconciliada.",
    );
  }
}

// Guard de mudança: não tenta regenerar metadata histórica. Em vez disso, impede que um PR
// altere schema.ts sem tocar simultaneamente no conjunto de migrations/journal.
function changedFiles() {
  const candidates = [
    ["diff", "--name-only", "HEAD^1", "HEAD"], // merge ref de pull_request no GitHub Actions
    ["diff", "--name-only", "HEAD^", "HEAD"],  // push/commit normal
  ];
  for (const args of candidates) {
    const result = spawnSync("git", args, { encoding: "utf8" });
    if (result.status === 0) return result.stdout.split(/\r?\n/).filter(Boolean);
  }
  warnings.push("Não foi possível calcular o diff do commit; guard schema→migration não executado.");
  return [];
}

const changed = changedFiles();
if (changed.includes(schemaPath)) {
  const migrationTouched = changed.some((file) => /^apps\/api\/drizzle\/\d{4}_.+\.sql$/.test(file));
  const journalTouched = changed.includes(journalPath);
  if (!migrationTouched || !journalTouched) {
    failures.push(
      `O ${schemaPath} foi alterado sem SQL de migration e journal correspondentes no mesmo conjunto de mudanças.`,
    );
  }
}

for (const warning of warnings) console.warn(`AVISO: ${warning}`);
if (failures.length) {
  for (const failure of failures) console.error(`ERRO: ${failure}`);
  process.exit(1);
}

console.log(
  `✓ Integridade de migrations: ${migrationFiles.length} SQL, ${entries.length} entradas no journal, ${snapshots.length} snapshots.`
);
