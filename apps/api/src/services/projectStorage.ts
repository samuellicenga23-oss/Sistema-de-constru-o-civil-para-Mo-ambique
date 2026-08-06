import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  budgetDocuments,
  companies,
  invoiceReceipts,
  measurementImportJobsTable,
  plants,
  projectInvoices,
  projects,
  siteDiaryEntries,
} from "../db/schema.js";
import { env } from "../env.js";

/** Marcador em file_path depois de apagar o ficheiro (coluna NOT NULL). */
export const PURGED_FILE_MARKER = "purged";

/** Dias sem actividade de leitura de plantas antes de ir para o lixo. */
export const PROJECT_TRASH_IDLE_DAYS = Number(process.env.PROJECT_TRASH_IDLE_DAYS ?? "7") || 7;

export type StorageCategory =
  | "plants"
  | "site_diary"
  | "import_jobs"
  | "invoice_receipts"
  | "logos"
  | "avatars"
  | "other";

export type CompanyStorageRow = {
  companyId: string;
  companyName: string;
  bytes: number;
  byCategory: Record<StorageCategory, number>;
  activeProjects: number;
  trashedProjects: number;
};

export type StorageOverview = {
  uploadsRoot: string;
  totalBytes: number;
  byCategory: Record<StorageCategory, number>;
  folders: Array<{ name: string; bytes: number; fileCount: number }>;
  companies: CompanyStorageRow[];
  orphanBytes: number;
  attributedBytes: number;
  trashCount: number;
  eligibleForTrashCount: number;
  idleDays: number;
};

export type TrashedProjectRow = {
  id: string;
  name: string;
  client: string | null;
  companyId: string;
  companyName: string;
  trashedAt: string;
  trashReason: string | null;
  filesPurgedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  plantCount: number;
};

async function safeUnlink(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath || filePath === PURGED_FILE_MARKER) return false;
  try {
    await unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(filePath: string | null | undefined): Promise<number> {
  if (!filePath || filePath === PURGED_FILE_MARKER) return 0;
  try {
    const s = await stat(filePath);
    return s.isFile() ? s.size : 0;
  } catch {
    return 0;
  }
}

function emptyCategories(): Record<StorageCategory, number> {
  return {
    plants: 0,
    site_diary: 0,
    import_jobs: 0,
    invoice_receipts: 0,
    logos: 0,
    avatars: 0,
    other: 0,
  };
}

function resolveSiteDiaryPhotoPath(photoUrl: string): string | null {
  const match = photoUrl.match(/\/api\/files\/site-diary\/[^/]+\/([^/?#]+)/);
  if (!match?.[1]) return null;
  return path.join(env.uploadsDir, "site-diary", match[1]);
}

/** Apaga PDFs/fotos pesados do projecto; mantém metadados na BD. */
export async function purgeProjectHeavyFiles(projectId: string): Promise<{ deletedFiles: number; bytesFreedEstimate: number }> {
  let deletedFiles = 0;
  let bytesFreedEstimate = 0;

  const plantRows = await db.select({ id: plants.id, filePath: plants.filePath }).from(plants).where(eq(plants.projectId, projectId));
  for (const plant of plantRows) {
    const size = await fileSize(plant.filePath);
    if (await safeUnlink(plant.filePath)) {
      deletedFiles += 1;
      bytesFreedEstimate += size;
      await db.update(plants).set({ filePath: PURGED_FILE_MARKER }).where(eq(plants.id, plant.id));
    } else if (plant.filePath !== PURGED_FILE_MARKER) {
      await db.update(plants).set({ filePath: PURGED_FILE_MARKER }).where(eq(plants.id, plant.id));
    }
  }

  const diaryRows = await db
    .select({ id: siteDiaryEntries.id, photoUrls: siteDiaryEntries.photoUrls })
    .from(siteDiaryEntries)
    .where(eq(siteDiaryEntries.projectId, projectId));
  for (const entry of diaryRows) {
    const urls = entry.photoUrls ?? [];
    for (const url of urls) {
      const filePath = resolveSiteDiaryPhotoPath(url);
      const size = await fileSize(filePath);
      if (await safeUnlink(filePath)) {
        deletedFiles += 1;
        bytesFreedEstimate += size;
      }
    }
    if (urls.length) {
      await db.update(siteDiaryEntries).set({ photoUrls: [] }).where(eq(siteDiaryEntries.id, entry.id));
    }
  }

  const importJobs = await db
    .select({ id: measurementImportJobsTable.id, filePath: measurementImportJobsTable.filePath })
    .from(measurementImportJobsTable)
    .innerJoin(budgetDocuments, eq(budgetDocuments.id, measurementImportJobsTable.documentId))
    .where(eq(budgetDocuments.projectId, projectId));
  for (const job of importJobs) {
    const size = await fileSize(job.filePath);
    if (await safeUnlink(job.filePath)) {
      deletedFiles += 1;
      bytesFreedEstimate += size;
    }
    if (job.filePath !== PURGED_FILE_MARKER) {
      await db.update(measurementImportJobsTable).set({ filePath: PURGED_FILE_MARKER }).where(eq(measurementImportJobsTable.id, job.id));
    }
  }

  const proofs = await db
    .select({ id: invoiceReceipts.id, proofFilePath: invoiceReceipts.proofFilePath })
    .from(invoiceReceipts)
    .innerJoin(projectInvoices, eq(projectInvoices.id, invoiceReceipts.invoiceId))
    .where(eq(projectInvoices.projectId, projectId));
  for (const proof of proofs) {
    const size = await fileSize(proof.proofFilePath);
    if (await safeUnlink(proof.proofFilePath)) {
      deletedFiles += 1;
      bytesFreedEstimate += size;
    }
    if (proof.proofFilePath) {
      await db.update(invoiceReceipts).set({ proofFilePath: null }).where(eq(invoiceReceipts.id, proof.id));
    }
  }

  return { deletedFiles, bytesFreedEstimate };
}

export async function softTrashProject(opts: {
  projectId: string;
  reason: string;
  trashedByUserId?: string | null;
}): Promise<{ ok: true; deletedFiles: number; bytesFreedEstimate: number } | { ok: false; error: string }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, opts.projectId)).limit(1);
  if (!project) return { ok: false, error: "Projecto não encontrado" };
  if (project.trashedAt) return { ok: false, error: "Projecto já está no lixo" };

  const purge = await purgeProjectHeavyFiles(opts.projectId);
  const now = new Date();
  await db
    .update(projects)
    .set({
      trashedAt: now,
      trashReason: opts.reason.slice(0, 120),
      trashedByUserId: opts.trashedByUserId ?? null,
      filesPurgedAt: now,
      archivedAt: project.archivedAt ?? now,
    })
    .where(eq(projects.id, opts.projectId));

  return { ok: true, deletedFiles: purge.deletedFiles, bytesFreedEstimate: purge.bytesFreedEstimate };
}

export async function restoreTrashedProject(projectId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return { ok: false, error: "Projecto não encontrado" };
  if (!project.trashedAt) return { ok: false, error: "Projecto não está no lixo" };

  await db
    .update(projects)
    .set({
      trashedAt: null,
      trashReason: null,
      trashedByUserId: null,
      // Ficheiros não voltam; fica arquivado para o cliente reactivar com consciência.
      archivedAt: project.archivedAt ?? new Date(),
    })
    .where(eq(projects.id, projectId));

  return { ok: true };
}

export async function permanentlyDeleteProject(projectId: string): Promise<{ ok: true; deletedFiles: number } | { ok: false; error: string }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return { ok: false, error: "Projecto não encontrado" };
  if (!project.trashedAt) return { ok: false, error: "Só é possível apagar definitivamente projectos no lixo" };

  const purge = await purgeProjectHeavyFiles(projectId);
  await db.delete(projects).where(eq(projects.id, projectId));
  return { ok: true, deletedFiles: purge.deletedFiles };
}

/** Projectos com todas as plantas concluídas e sem actividade há N dias. */
export async function findProjectsEligibleForWeeklyTrash(idleDays = PROJECT_TRASH_IDLE_DAYS) {
  // postgres.js não aceita Date em sql`` — passar ISO string.
  const cutoffIso = new Date(Date.now() - idleDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      companyId: projects.companyId,
      plantCount: sql<number>`count(${plants.id})::int`,
      pendingCount: sql<number>`count(*) filter (where ${plants.processingStatus} <> 'concluido')::int`,
      lastProcessedAt: sql<Date | null>`max(${plants.processingUpdatedAt})`,
    })
    .from(projects)
    .innerJoin(plants, eq(plants.projectId, projects.id))
    .where(isNull(projects.trashedAt))
    .groupBy(projects.id)
    .having(
      and(
        sql`count(${plants.id}) > 0`,
        sql`count(*) filter (where ${plants.processingStatus} <> 'concluido') = 0`,
        sql`max(${plants.processingUpdatedAt}) <= ${cutoffIso}::timestamptz`,
      ),
    );

  return rows;
}

export async function runWeeklyProjectTrashJob(logger?: { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void }) {
  const eligible = await findProjectsEligibleForWeeklyTrash();
  let trashed = 0;
  let filesDeleted = 0;
  let bytesFreed = 0;
  const errors: Array<{ projectId: string; error: string }> = [];

  for (const row of eligible) {
    const result = await softTrashProject({
      projectId: row.id,
      reason: `limpeza_semanal_lidos_${PROJECT_TRASH_IDLE_DAYS}d`,
      trashedByUserId: null,
    });
    if (result.ok) {
      trashed += 1;
      filesDeleted += result.deletedFiles;
      bytesFreed += result.bytesFreedEstimate;
    } else {
      errors.push({ projectId: row.id, error: result.error });
    }
  }

  const summary = {
    eligible: eligible.length,
    trashed,
    filesDeleted,
    bytesFreed,
    idleDays: PROJECT_TRASH_IDLE_DAYS,
    errors,
  };
  logger?.info(summary, "Weekly project trash job finished");
  return summary;
}

export async function listTrashedProjects(): Promise<TrashedProjectRow[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      client: projects.client,
      companyId: projects.companyId,
      companyName: companies.name,
      trashedAt: projects.trashedAt,
      trashReason: projects.trashReason,
      filesPurgedAt: projects.filesPurgedAt,
      archivedAt: projects.archivedAt,
      createdAt: projects.createdAt,
      plantCount: sql<number>`(select count(*)::int from ${plants} where ${plants.projectId} = ${projects.id})`,
    })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(sql`${projects.trashedAt} is not null`)
    .orderBy(desc(projects.trashedAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    client: row.client,
    companyId: row.companyId,
    companyName: row.companyName,
    trashedAt: row.trashedAt!.toISOString(),
    trashReason: row.trashReason,
    filesPurgedAt: row.filesPurgedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    plantCount: Number(row.plantCount ?? 0),
  }));
}

async function walkDirBytes(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await walkDirBytes(full);
    } else if (entry.isFile()) {
      try {
        total += (await stat(full)).size;
      } catch {
        /* ignore */
      }
    }
  }
  return total;
}

async function walkDirStats(dir: string): Promise<{ bytes: number; fileCount: number }> {
  let bytes = 0;
  let fileCount = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, fileCount: 0 };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkDirStats(full);
      bytes += nested.bytes;
      fileCount += nested.fileCount;
    } else if (entry.isFile()) {
      try {
        bytes += (await stat(full)).size;
        fileCount += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return { bytes, fileCount };
}

export async function getStorageOverview(): Promise<StorageOverview> {
  const byCategory = emptyCategories();
  const companyMap = new Map<string, CompanyStorageRow>();

  const allCompanies = await db.select({ id: companies.id, name: companies.name }).from(companies);
  for (const c of allCompanies) {
    companyMap.set(c.id, {
      companyId: c.id,
      companyName: c.name,
      bytes: 0,
      byCategory: emptyCategories(),
      activeProjects: 0,
      trashedProjects: 0,
    });
  }

  const projectCounts = await db
    .select({
      companyId: projects.companyId,
      active: sql<number>`count(*) filter (where ${projects.trashedAt} is null and ${projects.archivedAt} is null)::int`,
      trashed: sql<number>`count(*) filter (where ${projects.trashedAt} is not null)::int`,
    })
    .from(projects)
    .groupBy(projects.companyId);
  for (const row of projectCounts) {
    const entry = companyMap.get(row.companyId);
    if (!entry) continue;
    entry.activeProjects = Number(row.active ?? 0);
    entry.trashedProjects = Number(row.trashed ?? 0);
  }

  const addBytes = (companyId: string | null, category: StorageCategory, bytes: number) => {
    if (!bytes) return;
    byCategory[category] += bytes;
    if (!companyId) return;
    const entry = companyMap.get(companyId);
    if (!entry) return;
    entry.bytes += bytes;
    entry.byCategory[category] += bytes;
  };

  const plantFiles = await db
    .select({ filePath: plants.filePath, companyId: projects.companyId })
    .from(plants)
    .innerJoin(projects, eq(projects.id, plants.projectId))
    .where(ne(plants.filePath, PURGED_FILE_MARKER));
  const trackedPlantPaths = new Set<string>();
  for (const row of plantFiles) {
    trackedPlantPaths.add(path.resolve(row.filePath));
    addBytes(row.companyId, "plants", await fileSize(row.filePath));
  }

  const diaryFiles = await db
    .select({ photoUrls: siteDiaryEntries.photoUrls, companyId: projects.companyId })
    .from(siteDiaryEntries)
    .innerJoin(projects, eq(projects.id, siteDiaryEntries.projectId));
  for (const row of diaryFiles) {
    for (const url of row.photoUrls ?? []) {
      const filePath = resolveSiteDiaryPhotoPath(url);
      addBytes(row.companyId, "site_diary", await fileSize(filePath));
    }
  }

  const importFiles = await db
    .select({ filePath: measurementImportJobsTable.filePath, companyId: measurementImportJobsTable.companyId })
    .from(measurementImportJobsTable)
    .where(ne(measurementImportJobsTable.filePath, PURGED_FILE_MARKER));
  for (const row of importFiles) {
    addBytes(row.companyId, "import_jobs", await fileSize(row.filePath));
  }

  const proofFiles = await db
    .select({ proofFilePath: invoiceReceipts.proofFilePath, companyId: projects.companyId })
    .from(invoiceReceipts)
    .innerJoin(projectInvoices, eq(projectInvoices.id, invoiceReceipts.invoiceId))
    .innerJoin(projects, eq(projects.id, projectInvoices.projectId));
  for (const row of proofFiles) {
    addBytes(row.companyId, "invoice_receipts", await fileSize(row.proofFilePath));
  }

  const logoFiles = await db.select({ id: companies.id, logoUrl: companies.logoUrl }).from(companies);
  for (const row of logoFiles) {
    if (!row.logoUrl) continue;
    const base = path.basename(row.logoUrl);
    const filePath = path.join(env.uploadsDir, "logos", base);
    addBytes(row.id, "logos", await fileSize(filePath));
  }

  const totalOnDisk = await walkDirBytes(env.uploadsDir);
  const attributedBytes = Object.values(byCategory).reduce((a, b) => a + b, 0);
  const orphanBytes = Math.max(0, totalOnDisk - attributedBytes);

  // Orphans in plants/ (ficheiros sem linha na BD)
  try {
    const plantDir = path.join(env.uploadsDir, "plants");
    const entries = await readdir(plantDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.resolve(plantDir, entry.name);
      if (trackedPlantPaths.has(full)) continue;
      const size = await fileSize(full);
      byCategory.other += size;
    }
  } catch {
    /* pasta pode não existir */
  }

  // Pastas reais em disco (como no servidor)
  const folders: Array<{ name: string; bytes: number; fileCount: number }> = [];
  try {
    const rootEntries = await readdir(env.uploadsDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      const stats = await walkDirStats(path.join(env.uploadsDir, entry.name));
      if (stats.bytes > 0 || stats.fileCount > 0) {
        folders.push({ name: entry.name, bytes: stats.bytes, fileCount: stats.fileCount });
      }
    }
  } catch {
    /* uploads pode não existir */
  }
  folders.sort((a, b) => b.bytes - a.bytes);

  const eligible = await findProjectsEligibleForWeeklyTrash();
  const [{ value: trashCount }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(projects)
    .where(sql`${projects.trashedAt} is not null`);

  const companyRows = [...companyMap.values()].sort((a, b) => b.bytes - a.bytes);

  return {
    uploadsRoot: path.resolve(env.uploadsDir),
    totalBytes: totalOnDisk,
    byCategory,
    folders,
    companies: companyRows,
    orphanBytes,
    attributedBytes,
    trashCount: Number(trashCount ?? 0),
    eligibleForTrashCount: eligible.length,
    idleDays: PROJECT_TRASH_IDLE_DAYS,
  };
}

let trashJobTimer: ReturnType<typeof setInterval> | null = null;
let trashJobRunning = false;

export function startWeeklyProjectTrashScheduler(logger: {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}) {
  if (trashJobTimer) return;

  const tick = async () => {
    if (trashJobRunning) return;
    trashJobRunning = true;
    try {
      await runWeeklyProjectTrashJob(logger);
    } catch (error) {
      logger.error(error, "Weekly project trash job failed");
    } finally {
      trashJobRunning = false;
    }
  };

  // Primeira passagem 5 min após arranque; depois a cada 24 h (elegibilidade já exige N dias idle).
  const initial = setTimeout(() => {
    void tick();
  }, 5 * 60 * 1000);
  initial.unref?.();

  trashJobTimer = setInterval(() => {
    void tick();
  }, 24 * 60 * 60 * 1000);
  trashJobTimer.unref?.();

  logger.info({ idleDays: PROJECT_TRASH_IDLE_DAYS }, "Weekly project trash scheduler started");
}
