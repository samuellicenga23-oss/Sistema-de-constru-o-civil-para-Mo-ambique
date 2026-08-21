import { access, constants, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";

export type BackupCategory = {
  name: string;
  bytes: number;
  fileCount: number;
  /** Incluir em backup completo (PostgreSQL separado). */
  includeInBackup: boolean;
};

export type UploadsBackupManifest = {
  generatedAt: string;
  uploadsRoot: string;
  backupDir: string;
  totalBytes: number;
  categories: BackupCategory[];
  notes: string[];
};

const BACKUP_CATEGORIES = [
  "logos",
  "avatars",
  "plants",
  "site-diary",
  "payment-proofs",
  "supplier-invoice-fiscal",
  "supplier-payment-proofs",
  "invoice-receipts",
  "lead-proofs",
  "import-jobs",
] as const;

async function walkStats(dir: string): Promise<{ bytes: number; fileCount: number }> {
  let bytes = 0;
  let fileCount = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await walkStats(full);
        bytes += nested.bytes;
        fileCount += nested.fileCount;
      } else if (entry.isFile()) {
        const s = await stat(full);
        bytes += s.size;
        fileCount += 1;
      }
    }
  } catch {
    /* pasta pode não existir */
  }
  return { bytes, fileCount };
}

export async function buildUploadsBackupManifest(): Promise<UploadsBackupManifest> {
  const uploadsRoot = path.resolve(env.uploadsDir);
  const categories: BackupCategory[] = [];

  for (const name of BACKUP_CATEGORIES) {
    const stats = await walkStats(path.join(uploadsRoot, name));
    categories.push({
      name,
      bytes: stats.bytes,
      fileCount: stats.fileCount,
      includeInBackup: true,
    });
  }

  const totalBytes = categories.reduce((sum, row) => sum + row.bytes, 0);
  let uploadsWritable = false;
  try {
    await access(uploadsRoot, constants.R_OK | constants.W_OK);
    uploadsWritable = true;
  } catch {
    uploadsWritable = false;
  }

  return {
    generatedAt: new Date().toISOString(),
    uploadsRoot,
    backupDir: path.resolve(env.backupDir),
    totalBytes,
    categories: categories.sort((a, b) => b.bytes - a.bytes),
    notes: [
      "PostgreSQL deve ser incluído separadamente (pg_dump).",
      "Restore deve validar checksums e permissões por tenant.",
      uploadsWritable ? "Uploads acessíveis para leitura/escrita." : "Uploads não acessíveis — verificar UPLOADS_DIR.",
    ],
  };
}
