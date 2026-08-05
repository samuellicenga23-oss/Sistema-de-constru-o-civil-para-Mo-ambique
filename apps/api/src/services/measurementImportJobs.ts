/**
 * Jobs em memória para análise de mapas de quantidades em segundo plano
 * (mesmo padrão das plantas: upload → processar → consultar estado).
 */
import { randomUUID } from "node:crypto";
import {
  applyMeasurementsImport,
  previewMeasurementsImport,
  type ImportApplyDecision,
  type MeasurementImportPreview,
  type MeasurementImportResult,
} from "./measurementImport.js";

const JOB_TTL_MS = 45 * 60 * 1000;
const MAX_JOBS = 40;

export type MeasurementImportJobStatus = "pendente" | "processando" | "concluido" | "erro";

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

type InternalJob = MeasurementImportJob & {
  buffer: Buffer;
  filename: string;
};

const jobs = new Map<string, InternalJob>();
const active = new Set<string>();

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
  while (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (!oldest) break;
    jobs.delete(oldest[0]);
  }
}

function publicJob(job: InternalJob): MeasurementImportJob {
  const { buffer: _b, filename: _f, ...rest } = job;
  return rest;
}

function setProgress(job: InternalJob, progress: number, stage: string, status?: MeasurementImportJobStatus) {
  job.progress = Math.max(0, Math.min(100, Math.round(progress)));
  job.stage = stage;
  if (status) job.status = status;
  job.updatedAt = Date.now();
}

async function runJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job || active.has(jobId)) return;
  active.add(jobId);
  try {
    setProgress(job, 8, "A ler o ficheiro", "processando");
    setProgress(job, 25, "A extrair linhas do mapa");
    const preview = await previewMeasurementsImport(job.documentId, job.buffer, job.companyId, job.filename);
    setProgress(job, 85, "A mapear composições SIGO");
    job.preview = preview;
    setProgress(job, 100, "Análise concluída", "concluido");
  } catch (err) {
    job.errorMessage = err instanceof Error ? err.message : "Erro ao analisar o mapa";
    setProgress(job, job.progress || 10, "Erro na análise", "erro");
  } finally {
    active.delete(jobId);
  }
}

export function enqueueMeasurementImportJob(input: {
  companyId: string;
  documentId: string;
  buffer: Buffer;
  filename: string;
}): MeasurementImportJob {
  pruneJobs();
  const id = randomUUID();
  const now = Date.now();
  const job: InternalJob = {
    id,
    companyId: input.companyId,
    documentId: input.documentId,
    fileName: input.filename || "mapa",
    filename: input.filename || "mapa",
    buffer: input.buffer,
    status: "pendente",
    progress: 2,
    stage: "Na fila",
    errorMessage: null,
    preview: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  setImmediate(() => {
    void runJob(id);
  });
  return publicJob(job);
}

export function getMeasurementImportJob(jobId: string, companyId: string, documentId?: string): MeasurementImportJob | null {
  const job = jobs.get(jobId);
  if (!job || job.companyId !== companyId) return null;
  if (documentId && job.documentId !== documentId) return null;
  return publicJob(job);
}

export async function applyMeasurementImportJob(
  jobId: string,
  companyId: string,
  documentId: string,
  decisions: ImportApplyDecision[],
  options: { saveToCompanyTemplate?: boolean } = {},
): Promise<MeasurementImportResult> {
  const job = jobs.get(jobId);
  if (!job || job.companyId !== companyId || job.documentId !== documentId) {
    throw new Error("Trabalho de importação não encontrado ou expirado. Volte a carregar o ficheiro.");
  }
  if (job.status !== "concluido" || !job.buffer) {
    throw new Error("A análise ainda não terminou. Aguarde e tente novamente.");
  }
  return applyMeasurementsImport(documentId, job.buffer, companyId, decisions, {
    saveToCompanyTemplate: options.saveToCompanyTemplate,
    filename: job.filename,
  });
}
