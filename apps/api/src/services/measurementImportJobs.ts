/**
 * Jobs persistentes de análise de mapas de quantidades.
 * Ficheiro em disco + estado/preview em BD — sobrevivem a restart da API (como as plantas).
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { measurementImportJobsTable } from "../db/schema.js";
import { env } from "../env.js";
import {
  applyMeasurementsImport,
  parsedRowsFromPreview,
  previewMeasurementsImport,
  type ImportApplyDecision,
  type MeasurementImportPreview,
  type MeasurementImportResult,
  type ParsedExcelRow,
} from "./measurementImport.js";

const JOB_TTL_MS = 45 * 60 * 1000;
const MAX_JOBS_PER_COMPANY = 20;

export type MeasurementImportJobStatus = "pendente" | "processando" | "concluido" | "erro" | "aplicado";

export type MeasurementImportJob = {
  id: string;
  companyId: string;
  documentId: string;
  fileName: string;
  status: MeasurementImportJobStatus;
  progress: number;
  stage: string;
  errorMessage: string | null;
  preview: MeasurementImportPreview | null;
  createdAt: number;
  updatedAt: number;
};

const active = new Set<string>();

function toPublic(row: typeof measurementImportJobsTable.$inferSelect): MeasurementImportJob {
  return {
    id: row.id,
    companyId: row.companyId,
    documentId: row.documentId,
    fileName: row.fileName,
    status: row.status as MeasurementImportJobStatus,
    progress: row.progress,
    stage: row.stage ?? "",
    errorMessage: row.errorMessage,
    preview: (row.preview as MeasurementImportPreview | null) ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

async function setJobProgress(
  jobId: string,
  patch: {
    progress?: number;
    stage?: string;
    status?: MeasurementImportJobStatus;
    errorMessage?: string | null;
    preview?: MeasurementImportPreview | null;
    parsedRows?: ParsedExcelRow[] | null;
  },
) {
  await db
    .update(measurementImportJobsTable)
    .set({
      ...(patch.progress != null ? { progress: Math.max(0, Math.min(100, Math.round(patch.progress))) } : {}),
      ...(patch.stage != null ? { stage: patch.stage } : {}),
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
      ...(patch.preview !== undefined ? { preview: patch.preview as Record<string, unknown> | null } : {}),
      ...(patch.parsedRows !== undefined ? { parsedRows: patch.parsedRows } : {}),
      updatedAt: new Date(),
    })
    .where(eq(measurementImportJobsTable.id, jobId));
}

async function pruneOldJobs(companyId: string) {
  const cutoff = new Date(Date.now() - JOB_TTL_MS);
  const stale = await db
    .select({ id: measurementImportJobsTable.id, filePath: measurementImportJobsTable.filePath })
    .from(measurementImportJobsTable)
    .where(
      and(
        eq(measurementImportJobsTable.companyId, companyId),
        or(
          and(inArray(measurementImportJobsTable.status, ["concluido", "erro", "aplicado"]), lt(measurementImportJobsTable.updatedAt, cutoff)),
          and(eq(measurementImportJobsTable.status, "aplicado"), lt(measurementImportJobsTable.updatedAt, new Date(Date.now() - 60 * 60 * 1000))),
        ),
      ),
    )
    .limit(50);

  for (const row of stale) {
    await unlink(row.filePath).catch(() => undefined);
    await db.delete(measurementImportJobsTable).where(eq(measurementImportJobsTable.id, row.id));
  }

  const countRows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(measurementImportJobsTable)
    .where(eq(measurementImportJobsTable.companyId, companyId));
  const count = Number(countRows[0]?.c ?? 0);
  if (count <= MAX_JOBS_PER_COMPANY) return;

  const oldest = await db
    .select({ id: measurementImportJobsTable.id, filePath: measurementImportJobsTable.filePath })
    .from(measurementImportJobsTable)
    .where(eq(measurementImportJobsTable.companyId, companyId))
    .orderBy(asc(measurementImportJobsTable.createdAt))
    .limit(count - MAX_JOBS_PER_COMPANY);
  for (const row of oldest) {
    await unlink(row.filePath).catch(() => undefined);
    await db.delete(measurementImportJobsTable).where(eq(measurementImportJobsTable.id, row.id));
  }
}

async function runJob(jobId: string) {
  if (active.has(jobId)) return;
  active.add(jobId);
  try {
    const [job] = await db.select().from(measurementImportJobsTable).where(eq(measurementImportJobsTable.id, jobId)).limit(1);
    if (!job) return;

    await setJobProgress(jobId, { progress: 8, stage: "A ler o ficheiro", status: "processando", errorMessage: null });
    const buffer = await readFile(job.filePath);
    await setJobProgress(jobId, { progress: 25, stage: "A extrair linhas do mapa" });
    const preview = await previewMeasurementsImport(job.documentId, buffer, job.companyId, job.fileName);
    await setJobProgress(jobId, { progress: 85, stage: "A mapear composições SIGO" });
    const parsedRows = parsedRowsFromPreview(preview);
    await setJobProgress(jobId, {
      progress: 100,
      stage: "Análise concluída — reveja e aplique",
      status: "concluido",
      preview,
      parsedRows,
    });
  } catch (err) {
    await setJobProgress(jobId, {
      progress: 10,
      stage: "Erro na análise",
      status: "erro",
      errorMessage: err instanceof Error ? err.message : "Erro ao analisar o mapa",
    });
  } finally {
    active.delete(jobId);
  }
}

export async function enqueueMeasurementImportJob(input: {
  companyId: string;
  documentId: string;
  buffer: Buffer;
  filename: string;
}): Promise<MeasurementImportJob> {
  await pruneOldJobs(input.companyId);
  const id = randomUUID();
  const uploadsDir = path.join(env.uploadsDir, "import-jobs");
  await mkdir(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, `${id}.bin`);
  await writeFile(filePath, input.buffer);

  const now = new Date();
  const [row] = await db
    .insert(measurementImportJobsTable)
    .values({
      id,
      companyId: input.companyId,
      documentId: input.documentId,
      fileName: input.filename || "mapa",
      filePath,
      status: "pendente",
      progress: 2,
      stage: "Na fila",
      errorMessage: null,
      preview: null,
      parsedRows: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  setImmediate(() => {
    void runJob(id);
  });
  return toPublic(row);
}

export async function getMeasurementImportJob(
  jobId: string,
  companyId: string,
  documentId?: string,
): Promise<MeasurementImportJob | null> {
  const [row] = await db.select().from(measurementImportJobsTable).where(eq(measurementImportJobsTable.id, jobId)).limit(1);
  if (!row || row.companyId !== companyId) return null;
  if (documentId && row.documentId !== documentId) return null;
  return toPublic(row);
}

export async function applyMeasurementImportJob(
  jobId: string,
  companyId: string,
  documentId: string,
  decisions: ImportApplyDecision[],
  options: { saveToCompanyTemplate?: boolean } = {},
): Promise<MeasurementImportResult> {
  const [job] = await db.select().from(measurementImportJobsTable).where(eq(measurementImportJobsTable.id, jobId)).limit(1);
  if (!job || job.companyId !== companyId || job.documentId !== documentId) {
    throw new Error("Trabalho de importação não encontrado ou expirado. Volte a carregar o ficheiro.");
  }
  if (job.status === "aplicado") {
    throw new Error("Esta importação já foi aplicada. Carregue o ficheiro novamente para uma nova importação.");
  }
  if (job.status !== "concluido" || !job.preview) {
    throw new Error("A análise ainda não terminou. Aguarde e tente novamente.");
  }
  if (active.has(jobId)) {
    throw new Error("Esta importação já está a ser aplicada. Aguarde.");
  }

  active.add(jobId);
  try {
    const parsedRows =
      (job.parsedRows as ParsedExcelRow[] | null)?.length
        ? (job.parsedRows as ParsedExcelRow[])
        : parsedRowsFromPreview(job.preview as unknown as MeasurementImportPreview);
    const buffer = await readFile(job.filePath);
    const result = await applyMeasurementsImport(documentId, buffer, companyId, decisions, {
      saveToCompanyTemplate: options.saveToCompanyTemplate,
      filename: job.fileName,
      parsedRows,
    });
    await setJobProgress(jobId, {
      status: "aplicado",
      stage: "Aplicada",
      progress: 100,
      preview: null,
      parsedRows: null,
    });
    await unlink(job.filePath).catch(() => undefined);
    return result;
  } finally {
    active.delete(jobId);
  }
}

/** Retoma jobs pendentes/processando após restart da API. */
export async function resumeMeasurementImportJobs(): Promise<number> {
  const rows = await db
    .select({ id: measurementImportJobsTable.id })
    .from(measurementImportJobsTable)
    .where(inArray(measurementImportJobsTable.status, ["pendente", "processando"]))
    .limit(40);

  for (const row of rows) {
    await setJobProgress(row.id, { status: "pendente", stage: "A retomar após reinício", progress: 2 });
    setImmediate(() => {
      void runJob(row.id);
    });
  }
  return rows.length;
}
