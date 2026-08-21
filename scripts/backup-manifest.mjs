#!/usr/bin/env node
/** Manifesto de categorias de uploads para backup/restore. */
import { spawnSync } from "node:child_process";

const jsonOnly = process.argv.includes("--json");
const snippet = `
import { buildUploadsBackupManifest } from './apps/api/src/services/backupManifest.ts';
const manifest = await buildUploadsBackupManifest();
console.log(JSON.stringify(manifest));
`;

const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", snippet], {
  encoding: "utf8",
  cwd: process.cwd(),
  env: process.env,
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "backup-manifest failed");
  process.exit(result.status ?? 1);
}

const manifest = JSON.parse(result.stdout.trim());
if (jsonOnly) {
  console.log(JSON.stringify(manifest, null, 2));
} else {
  console.log(`Backup manifest — ${manifest.generatedAt}`);
  console.log(`Uploads: ${manifest.uploadsRoot} (${(manifest.totalBytes / 1024 / 1024).toFixed(2)} MB)`);
  for (const cat of manifest.categories) {
    if (cat.fileCount > 0) console.log(`  ${cat.name}: ${cat.fileCount} ficheiro(s), ${(cat.bytes / 1024 / 1024).toFixed(2)} MB`);
  }
  for (const note of manifest.notes) console.log(`  • ${note}`);
}
